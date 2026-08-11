import { randomUUID } from "node:crypto";
import {
  type AgentInferenceOutcome,
  type AgentInferencePhase,
  type AgentInferenceTurn,
  AgentInferenceTurnSchema,
  type AgentTrace,
  AgentTraceSchema,
  type AuditEventInput,
  type ContentHash,
  type JobId,
  type RequestId,
} from "@vault/shared";
import type { ChatInput, GenerationInput } from "../runtime/inference.js";
import type { ArtifactStore } from "../workspace/artifacts.js";
import type { DatabasePort } from "../workspace/database.js";

interface TraceArtifactStore {
  put(bytes: Uint8Array): Promise<ContentHash>;
  read(hash: ContentHash): Promise<Buffer>;
}

interface TraceRequest {
  input: GenerationInput | ChatInput;
  requestId: RequestId;
  jobId: JobId;
}

export type TraceAuditAppender = (event: AuditEventInput) => void;

interface TraceTurnRow {
  id: string;
  run_id: string;
  sequence: number;
  phase: string;
  request_id: string;
  job_id: string;
  model_id: string;
  context_size: string;
  max_tokens: number;
  allocated_context_tokens: number | null;
  prompt_hash: ContentHash;
  schema_hash: ContentHash;
  response_hash: ContentHash | null;
  outcome: string | null;
  execution_sequence: number | null;
  created_at: string;
  response_captured_at: string | null;
  completed_at: string | null;
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, sortedJsonValue(item)]),
  );
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(sortedJsonValue(value));
  if (serialized === undefined) throw new Error("trace_payload_invalid");
  return serialized;
}

function nextTraceSequence(database: DatabasePort, runId: string): number {
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM agent_inference_turns WHERE run_id = ?",
    )
    .get(runId) as { sequence: number };
  return row.sequence;
}

function contextSize(value: string): number | "auto" {
  if (value === "auto") return value;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("trace_context_invalid");
  return parsed;
}

export class AgentTraceStore {
  constructor(
    private readonly database: DatabasePort,
    private readonly artifacts: TraceArtifactStore | Pick<ArtifactStore, "put" | "read">,
    private readonly audit?: TraceAuditAppender,
  ) {}

  async begin(runId: string, phase: AgentInferencePhase, request: TraceRequest): Promise<string> {
    const run = this.database
      .prepare("SELECT trace_version FROM agent_runs WHERE id = ?")
      .get(runId) as { trace_version: number } | undefined;
    if (run === undefined) throw new Error("run_not_found");
    if (run.trace_version !== 1) throw new Error("trace_not_enabled");
    const prompt =
      "prompt" in request.input ? request.input.prompt : canonicalJson(request.input.messages);
    const schema = canonicalJson(
      "jsonSchema" in request.input ? request.input.jsonSchema : { tools: request.input.tools },
    );
    const [promptHash, schemaHash] = await Promise.all([
      this.artifacts.put(Buffer.from(prompt, "utf8")),
      this.artifacts.put(Buffer.from(schema, "utf8")),
    ]);
    const id = randomUUID();
    this.database
      .prepare(
        "INSERT INTO agent_inference_turns (id, run_id, sequence, phase, request_id, job_id, model_id, context_size, max_tokens, prompt_hash, schema_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        runId,
        nextTraceSequence(this.database, runId),
        phase,
        String(request.requestId),
        request.jobId,
        request.input.modelId,
        String(request.input.contextSize),
        request.input.maxTokens,
        promptHash,
        schemaHash,
        new Date().toISOString(),
      );
    return id;
  }

  async captureResponse(
    turnId: string,
    value: unknown,
    allocatedContextTokens?: number,
  ): Promise<void> {
    const responseHash = await this.artifacts.put(Buffer.from(canonicalJson(value), "utf8"));
    const update = this.database
      .prepare(
        "UPDATE agent_inference_turns SET response_hash = ?, allocated_context_tokens = ?, response_captured_at = ? WHERE id = ? AND response_hash IS NULL AND outcome IS NULL",
      )
      .run(responseHash, allocatedContextTokens ?? null, new Date().toISOString(), turnId);
    if (update.changes !== 1) throw new Error("trace_turn_not_pending");
  }

  recordOutcome(turnId: string, outcome: AgentInferenceOutcome, executionSequence?: number): void {
    this.database.transaction(() => {
      const row = this.auditRow(turnId);
      const update = this.database
        .prepare(
          "UPDATE agent_inference_turns SET outcome = ?, execution_sequence = ?, completed_at = ? WHERE id = ? AND outcome IS NULL",
        )
        .run(outcome, executionSequence ?? null, new Date().toISOString(), turnId);
      if (update.changes !== 1) throw new Error("trace_turn_not_pending");
      this.appendAudit(row, outcome, executionSequence);
    })();
  }

  interruptIncomplete(runId: string, completedAt = new Date().toISOString()): number {
    return this.interruptRows(
      this.database
        .prepare("SELECT * FROM agent_inference_turns WHERE run_id = ? AND outcome IS NULL")
        .all(runId) as TraceTurnRow[],
      completedAt,
    );
  }

  interruptAllIncomplete(completedAt = new Date().toISOString()): number {
    return this.interruptRows(
      this.database
        .prepare("SELECT * FROM agent_inference_turns WHERE outcome IS NULL")
        .all() as TraceTurnRow[],
      completedAt,
    );
  }

  private interruptRows(rows: TraceTurnRow[], completedAt: string): number {
    return this.database.transaction(() => {
      for (const row of rows) {
        const update = this.database
          .prepare(
            "UPDATE agent_inference_turns SET outcome = 'interrupted', completed_at = ? WHERE id = ? AND outcome IS NULL",
          )
          .run(completedAt, row.id);
        if (update.changes !== 1) throw new Error("trace_turn_not_pending");
        this.appendAudit(row, "interrupted");
      }
      return rows.length;
    })();
  }

  private auditRow(turnId: string): TraceTurnRow {
    const row = this.database
      .prepare("SELECT * FROM agent_inference_turns WHERE id = ?")
      .get(turnId) as TraceTurnRow | undefined;
    if (row === undefined) throw new Error("trace_turn_not_found");
    return row;
  }

  private appendAudit(
    row: TraceTurnRow,
    outcome: AgentInferenceOutcome,
    executionSequence?: number,
  ): void {
    this.audit?.({
      type: "agent.inference_turn",
      outcome: "succeeded",
      metadata: {
        turnId: row.id,
        runId: row.run_id,
        requestId: row.request_id,
        jobId: row.job_id,
        requestInputHash: row.prompt_hash,
        schemaHash: row.schema_hash,
        responseHash: row.response_hash,
        decisionOutcome: outcome,
        executionSequence: executionSequence ?? null,
      },
    });
  }

  async get(runId: string): Promise<AgentTrace> {
    const run = this.database
      .prepare("SELECT trace_version FROM agent_runs WHERE id = ?")
      .get(runId) as { trace_version: number } | undefined;
    if (run === undefined) throw new Error("run_not_found");
    if (run.trace_version === 0) {
      return AgentTraceSchema.parse({
        runId,
        captureVersion: 0,
        status: "not_recorded",
        turns: [],
      });
    }
    const rows = this.database
      .prepare("SELECT * FROM agent_inference_turns WHERE run_id = ? ORDER BY sequence")
      .all(runId) as TraceTurnRow[];
    const turns = await Promise.all(rows.map(async (row) => await this.resolveTurn(row)));
    return AgentTraceSchema.parse({ runId, captureVersion: 1, status: "recorded", turns });
  }

  private async resolveTurn(row: TraceTurnRow): Promise<AgentInferenceTurn> {
    const [prompt, schema, response] = await Promise.all([
      this.artifacts.read(row.prompt_hash),
      this.artifacts.read(row.schema_hash),
      row.response_hash === null ? undefined : this.artifacts.read(row.response_hash),
    ]);
    return AgentInferenceTurnSchema.parse({
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      phase: row.phase,
      requestId: row.request_id,
      jobId: row.job_id,
      modelId: row.model_id,
      contextSize: contextSize(row.context_size),
      maxTokens: row.max_tokens,
      allocatedContextTokens: row.allocated_context_tokens,
      promptHash: row.prompt_hash,
      schemaHash: row.schema_hash,
      responseHash: row.response_hash,
      prompt: prompt.toString("utf8"),
      jsonSchema: JSON.parse(schema.toString("utf8")),
      structuredResponse: response === undefined ? null : JSON.parse(response.toString("utf8")),
      outcome: row.outcome,
      executionSequence: row.execution_sequence,
      createdAt: row.created_at,
      responseCapturedAt: row.response_captured_at,
      completedAt: row.completed_at,
    });
  }
}

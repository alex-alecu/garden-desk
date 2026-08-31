import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  type AgentArtifactSummary,
  AgentArtifactSummarySchema,
  type AgentEvent,
  type AgentEventDetail,
  AgentEventSchema,
  type AgentEventType,
  type AgentRunPerformance,
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AgentRunState,
  type AgentRunSummary,
  AgentRunSummarySchema,
  type AttachmentSummary,
  AttachmentSummarySchema,
  type SessionDraft,
  SessionDraftSchema,
} from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import type { DatabasePort } from "../workspace/database.js";
import { materializeAttachment } from "./attachment-materialization.js";
import { AgentExecutionStore } from "./execution-store.js";
import {
  type ArtifactRow,
  artifactFromRow,
  attachmentFromRow,
  attachmentMediaType,
  type EventRow,
  eventFromRow,
  nextEventSequence,
  type RunRow,
  readSelectedFile,
  runFromRow,
} from "./records.js";
import { recoverInterruptedRuns } from "./recovery.js";
import { AgentTraceStore, type TraceAuditAppender } from "./trace-store.js";

interface RunTransition {
  state: AgentRunState;
  response?: string;
  error?: string;
  performance?: AgentRunPerformance;
}

export class AgentStore {
  readonly execution: AgentExecutionStore;
  readonly trace: AgentTraceStore;

  constructor(
    private readonly database: DatabasePort,
    private readonly artifacts: ArtifactStore,
    traceAudit?: TraceAuditAppender,
  ) {
    this.execution = new AgentExecutionStore(database);
    this.trace = new AgentTraceStore(database, artifacts, traceAudit);
  }

  saveDraft(sessionId: string, content: string): SessionDraft {
    const updatedAt = new Date().toISOString();
    const draft = SessionDraftSchema.parse({ sessionId, content, updatedAt });
    const session = this.database.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId);
    if (session === undefined) throw new Error("session_not_found");
    this.database
      .prepare(
        "INSERT INTO session_drafts (session_id, content, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at",
      )
      .run(draft.sessionId, draft.content, draft.updatedAt);
    return draft;
  }

  loadDraft(sessionId: string): SessionDraft | undefined {
    const row = this.database
      .prepare("SELECT session_id, content, updated_at FROM session_drafts WHERE session_id = ?")
      .get(sessionId) as { session_id: string; content: string; updated_at: string } | undefined;
    return row === undefined
      ? undefined
      : SessionDraftSchema.parse({
          sessionId: row.session_id,
          content: row.content,
          updatedAt: row.updated_at,
        });
  }

  async addAttachment(sessionId: string, path: string): Promise<AttachmentSummary> {
    if (this.database.prepare("SELECT 1 FROM sessions WHERE id = ?").get(sessionId) === undefined) {
      throw new Error("session_not_found");
    }
    const bytes = await readSelectedFile(path);
    const createdAt = new Date().toISOString();
    const item = AttachmentSummarySchema.parse({
      id: randomUUID(),
      sessionId,
      name: basename(path),
      mediaType: attachmentMediaType(path),
      byteLength: bytes.byteLength,
      contentHash: await this.artifacts.put(bytes),
      createdAt,
    });
    this.database
      .prepare("INSERT INTO session_attachments VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.sessionId,
        item.name,
        item.mediaType,
        item.byteLength,
        item.contentHash,
        item.createdAt,
      );
    return item;
  }

  listAttachments(sessionId: string): AttachmentSummary[] {
    return (
      this.database
        .prepare("SELECT * FROM session_attachments WHERE session_id = ? ORDER BY created_at, id")
        .all(sessionId) as Array<Parameters<typeof attachmentFromRow>[0]>
    ).map(attachmentFromRow);
  }

  removeAttachment(sessionId: string, attachmentId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM session_attachments WHERE id = ? AND session_id = ?")
        .run(attachmentId, sessionId).changes === 1
    );
  }

  async attachmentBytes(item: AttachmentSummary): Promise<Buffer> {
    return await this.artifacts.read(item.contentHash);
  }
  async materializeAttachment(sessionId: string, attachmentId: string): Promise<string> {
    return await materializeAttachment(this.database, this.artifacts, sessionId, attachmentId);
  }
  createRun(sessionId: string, jobId: string, parentRunId?: string): AgentRunSummary {
    const now = new Date().toISOString();
    const result = AgentRunSummarySchema.parse({
      id: randomUUID(),
      sessionId,
      parentRunId: parentRunId ?? null,
      jobId,
      state: "queued",
      response: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    this.database
      .prepare(
        "INSERT INTO agent_runs (id, session_id, parent_run_id, job_id, state, response, error, created_at, updated_at, performance_json, trace_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
      )
      .run(
        result.id,
        result.sessionId,
        result.parentRunId,
        result.jobId,
        result.state,
        null,
        null,
        result.createdAt,
        result.updatedAt,
        null,
      );
    return result;
  }
  transitionRun(id: string, transition: RunTransition): void {
    const updatedAt = new Date().toISOString();
    const update = this.database
      .prepare(
        "UPDATE agent_runs SET state = ?, response = ?, error = ?, updated_at = ?, performance_json = ? WHERE id = ?",
      )
      .run(
        transition.state,
        transition.response ?? null,
        transition.error ?? null,
        updatedAt,
        transition.performance === undefined ? null : JSON.stringify(transition.performance),
        id,
      );
    if (update.changes !== 1) throw new Error("run_not_found");
  }
  appendEvent(
    runId: string,
    type: AgentEventType,
    summary: string,
    detail: Partial<AgentEventDetail> = {},
  ): AgentEvent {
    const item = AgentEventSchema.parse({
      id: randomUUID(),
      runId,
      sequence: nextEventSequence(this.database, runId),
      type,
      summary,
      ...detail,
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        "INSERT INTO agent_events (id, run_id, sequence, event_type, summary, tool_name, tool_call_id, language, code, stdout, stderr, termination, created_at, workspace_path, command, exit_code, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        item.id,
        item.runId,
        item.sequence,
        item.type,
        item.summary,
        item.toolName,
        item.toolCallId,
        item.language,
        item.source,
        item.stdout,
        item.stderr,
        item.termination,
        item.createdAt,
        item.path,
        item.command,
        item.exitCode,
        item.durationMs,
      );
    return item;
  }
  recordEventDuration(eventId: string, durationMs: number): void {
    const update = this.database
      .prepare("UPDATE agent_events SET duration_ms = ? WHERE id = ? AND duration_ms IS NULL")
      .run(Math.max(0, Math.round(durationMs)), eventId);
    if (update.changes !== 1) throw new Error("agent_event_not_pending");
  }
  addArtifact(
    runId: string,
    input: Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">,
  ): AgentArtifactSummary {
    const item = AgentArtifactSummarySchema.parse({
      id: randomUUID(),
      runId,
      ...input,
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare("INSERT INTO agent_artifacts VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        item.id,
        item.runId,
        item.name,
        item.mediaType,
        item.byteLength,
        item.contentHash,
        item.createdAt,
      );
    return item;
  }
  snapshot(runId: string): AgentRunSnapshot {
    const runRow = this.database.prepare("SELECT * FROM agent_runs WHERE id = ?").get(runId) as
      | RunRow
      | undefined;
    if (runRow === undefined) throw new Error("run_not_found");
    const events = (
      this.database
        .prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY sequence")
        .all(runId) as EventRow[]
    ).map(eventFromRow);
    const executions = this.execution.list(runId);
    const artifacts = (
      this.database
        .prepare("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at, id")
        .all(runId) as ArtifactRow[]
    ).map(artifactFromRow);
    return AgentRunSnapshotSchema.parse({
      run: runFromRow(runRow),
      events,
      executions,
      artifacts,
    });
  }
  listRuns(sessionId: string): AgentRunSummary[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM (SELECT * FROM agent_runs WHERE session_id = ? AND parent_run_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 100) ORDER BY created_at, id",
      )
      .all(sessionId) as RunRow[];
    return rows.map(runFromRow);
  }

  recoverInterrupted(): number {
    const recovered = recoverInterruptedRuns(
      this.database,
      this.execution,
      (runId) => this.trace.interruptIncomplete(runId),
      (runId) => this.appendEvent(runId, "run.failed", "Interrupted when Garden Desk restarted."),
    );
    this.trace.interruptAllIncomplete();
    return recovered;
  }
}

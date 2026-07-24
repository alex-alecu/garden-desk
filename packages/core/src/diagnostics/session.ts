import { basename, join } from "node:path";
import { AgentInferenceTurnSchema, type AgentTrace, AgentTraceSchema } from "@vault/shared";
import {
  type DebugCatalogRecords,
  type DebugRunRecords,
  readDebugCatalog,
  type TraceTurnRecord,
} from "./database.js";
import { DebugSessionError, debugStateInvalid } from "./errors.js";
import {
  makePrivateDirectory,
  makeSnapshotDirectory,
  readStableWorkspace,
  readVerifiedArtifact,
  removeSnapshot,
  writePrivateFile,
  writePrivateJson,
} from "./files.js";
import { writeWorkspaceSnapshot } from "./workspace-snapshot.js";

const SNAPSHOT_VERSION = 1;

function text(value: unknown): string {
  return typeof value === "string" ? value : debugStateInvalid();
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function number(value: unknown): number {
  return typeof value === "number" ? value : debugStateInvalid();
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}

function date(value: unknown): string | null {
  return nullableText(value);
}

function contextSize(value: unknown): number | "auto" {
  if (value === "auto") return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : debugStateInvalid();
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return debugStateInvalid();
  }
}

async function resolveTraceTurn(
  internalRoot: string,
  row: TraceTurnRecord,
): Promise<ReturnType<typeof AgentInferenceTurnSchema.parse>> {
  const [prompt, schema, response] = await Promise.all([
    readVerifiedArtifact(internalRoot, row.prompt_hash),
    readVerifiedArtifact(internalRoot, row.schema_hash),
    row.response_hash === null
      ? Promise.resolve(undefined)
      : readVerifiedArtifact(internalRoot, row.response_hash),
  ]);
  try {
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
      allocatedContextTokens: nullableNumber(row.allocated_context_tokens),
      promptHash: row.prompt_hash,
      schemaHash: row.schema_hash,
      responseHash: row.response_hash,
      prompt: prompt.toString("utf8"),
      jsonSchema: parseJson(schema),
      structuredResponse: response === undefined ? null : parseJson(response),
      outcome: nullableText(row.outcome),
      executionSequence: nullableNumber(row.execution_sequence),
      createdAt: text(row.created_at),
      responseCapturedAt: date(row.response_captured_at),
      completedAt: date(row.completed_at),
    });
  } catch (error) {
    if (error instanceof DebugSessionError) throw error;
    return debugStateInvalid();
  }
}

async function resolveTrace(internalRoot: string, records: DebugRunRecords): Promise<AgentTrace> {
  if (records.traceVersion === 0) {
    if (records.traceTurns.length !== 0) debugStateInvalid();
    return AgentTraceSchema.parse({
      runId: records.run.id,
      captureVersion: 0,
      status: "not_recorded",
      turns: [],
    });
  }
  if (records.traceVersion !== 1) debugStateInvalid();
  const turns = [];
  for (const row of records.traceTurns) {
    turns.push(await resolveTraceTurn(internalRoot, row));
  }
  return AgentTraceSchema.parse({
    runId: records.run.id,
    captureVersion: 1,
    status: "recorded",
    turns,
  });
}

function safeArtifactName(name: string): string {
  const safe = basename(name).replaceAll(/[^A-Za-z0-9._ -]/gu, "_");
  return safe.length === 0 || safe === "." || safe === ".." ? "artifact" : safe;
}

async function writeRun(
  root: string,
  internalRoot: string,
  records: DebugRunRecords,
  trace: AgentTrace,
): Promise<void> {
  const runRoot = join(root, "logs", records.run.id);
  const artifacts = [];
  for (const artifact of records.artifacts) {
    const relativePath = `artifacts/${records.run.id}/${artifact.id}-${safeArtifactName(artifact.name)}`;
    const bytes = await readVerifiedArtifact(
      internalRoot,
      artifact.contentHash,
      artifact.byteLength,
    );
    await writePrivateFile(join(root, relativePath), bytes);
    artifacts.push({ ...artifact, snapshotPath: relativePath });
  }
  await writePrivateJson(join(runRoot, "run.json"), {
    snapshotVersion: SNAPSHOT_VERSION,
    run: records.run,
    artifacts,
  });
  await writePrivateJson(join(runRoot, "events.json"), {
    snapshotVersion: SNAPSHOT_VERSION,
    runId: records.run.id,
    events: records.events,
  });
  await writePrivateJson(join(runRoot, "trace.json"), trace);
  await makePrivateDirectory(join(runRoot, "executions"));
  for (const execution of records.executions) {
    const name = `${String(execution.sequence).padStart(4, "0")}.json`;
    await writePrivateJson(join(runRoot, "executions", name), execution);
  }
}

async function populateSnapshot(root: string, records: DebugCatalogRecords): Promise<void> {
  const [workspace, traces] = await Promise.all([
    readStableWorkspace(records.internalRoot, records.session.id),
    Promise.all(records.runs.map(async (run) => await resolveTrace(records.internalRoot, run))),
  ]);
  await writePrivateJson(join(root, "session.json"), {
    snapshotVersion: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    database: { path: records.databasePath, schemaVersion: records.schemaVersion },
    session: records.session,
    folder: records.folder,
    draft: records.draft,
    attachments: records.attachments,
    workspaceManifestHash: workspace.manifestHash,
    runs: records.runs.map((item) => item.run),
  });
  await writePrivateJson(join(root, "conversation.json"), {
    snapshotVersion: SNAPSHOT_VERSION,
    sessionId: records.session.id,
    messages: records.messages,
  });
  await writeWorkspaceSnapshot(join(root, "workspace"), workspace.entries);
  await makePrivateDirectory(join(root, "artifacts"));
  await makePrivateDirectory(join(root, "logs"));
  for (let index = 0; index < records.runs.length; index += 1) {
    const run = records.runs[index];
    const trace = traces[index];
    if (run === undefined || trace === undefined) debugStateInvalid();
    await writeRun(root, records.internalRoot, run, trace);
  }
}

export async function createSessionDebugSnapshot(
  databasePath: string,
  sessionId: string,
): Promise<string> {
  const records = await readDebugCatalog(databasePath, sessionId);
  const root = await makeSnapshotDirectory();
  try {
    await populateSnapshot(root, records);
    return root;
  } catch (error) {
    await removeSnapshot(root);
    if (error instanceof DebugSessionError) throw error;
    throw new DebugSessionError("debug_state_invalid");
  }
}

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname } from "node:path";
import {
  type AgentArtifactSummary,
  AgentArtifactSummarySchema,
  type AgentEvent,
  AgentEventSchema,
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  AgentRunPerformanceSchema,
  type AgentRunSummary,
  AgentRunSummarySchema,
  type AttachmentSummary,
  AttachmentSummarySchema,
} from "@gardendesk/shared";
import type { DatabasePort } from "../workspace/database.js";

const MAX_ATTACHMENT_BYTES = 512 * 1024 * 1024;

export function nextEventSequence(database: DatabasePort, runId: string): number {
  const row = database
    .prepare(
      "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM agent_events WHERE run_id = ?",
    )
    .get(runId) as { sequence: number };
  return row.sequence;
}

export interface RunRow {
  id: string;
  session_id: string;
  parent_run_id: string | null;
  job_id: string;
  state: string;
  response: string | null;
  error: string | null;
  performance_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: string;
  summary: string;
  tool_name: string | null;
  tool_call_id: string | null;
  language: string | null;
  code: string | null;
  workspace_path: string | null;
  command: string | null;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  duration_ms: number | null;
  termination: string | null;
  created_at: string;
}

export interface ExecutionRow {
  id: string;
  run_id: string;
  sequence: number;
  language: string;
  workspace_path: string | null;
  code: string | null;
  command: string | null;
  state: string;
  exit_code: number | null;
  duration_ms: number | null;
  termination: string | null;
  stdout: Buffer | string;
  stderr: Buffer | string;
  vm_diagnostics_json: string;
  stdout_truncated: number;
  stderr_truncated: number;
  vm_diagnostics_truncated: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  display_name: string;
  media_type: string;
  byte_length: number;
  content_hash: string;
  created_at: string;
}

export interface AttachmentRow {
  id: string;
  session_id: string;
  display_name: string;
  media_type: string;
  byte_length: number;
  content_hash: string;
  created_at: string;
}

export function runFromRow(row: RunRow): AgentRunSummary {
  const performance =
    row.performance_json === null
      ? null
      : AgentRunPerformanceSchema.parse(JSON.parse(row.performance_json));
  return AgentRunSummarySchema.parse({
    id: row.id,
    sessionId: row.session_id,
    parentRunId: row.parent_run_id,
    jobId: row.job_id,
    state: row.state,
    response: row.response,
    error: row.error,
    performance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function eventFromRow(row: EventRow): AgentEvent {
  return AgentEventSchema.parse({
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    summary: row.summary,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    language: row.language,
    path: row.workspace_path,
    source: row.code,
    command: row.command,
    exitCode: row.exit_code,
    stdout: row.stdout,
    stderr: row.stderr,
    durationMs: row.duration_ms,
    termination: row.termination,
    createdAt: row.created_at,
  });
}

function logBytes(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

export function executionFromRow(row: ExecutionRow): AgentExecutionSnapshot {
  const stdout = logBytes(row.stdout);
  const stderr = logBytes(row.stderr);
  return AgentExecutionSnapshotSchema.parse({
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    language: row.language,
    path: row.workspace_path,
    source: row.code,
    command: row.command,
    state: row.state,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    termination: row.termination,
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    vmDiagnostics: JSON.parse(row.vm_diagnostics_json),
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
    vmDiagnosticsBytes: Buffer.byteLength(row.vm_diagnostics_json),
    stdoutTruncated: row.stdout_truncated === 1,
    stderrTruncated: row.stderr_truncated === 1,
    vmDiagnosticsTruncated: row.vm_diagnostics_truncated === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

export function artifactFromRow(row: ArtifactRow): AgentArtifactSummary {
  return AgentArtifactSummarySchema.parse({
    id: row.id,
    runId: row.run_id,
    name: row.display_name,
    mediaType: row.media_type,
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
}

export function attachmentFromRow(row: AttachmentRow): AttachmentSummary {
  return AttachmentSummarySchema.parse({
    id: row.id,
    sessionId: row.session_id,
    name: row.display_name,
    mediaType: row.media_type,
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
}

export function attachmentMediaType(path: string): string {
  const types: Record<string, string> = {
    ".csv": "text/csv",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function readSelectedFile(path: string): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("attachment_invalid");
  }
  const canonical = await realpath(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      (await realpath(path)) !== canonical
    ) {
      throw new Error("attachment_changed");
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

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
  type ConversationMessage,
  ConversationMessageSchema,
  type SessionDraft,
  SessionDraftSchema,
  type SessionSummary,
  SessionSummarySchema,
} from "@vault/shared";
import { debugStateInvalid } from "./errors.js";

export type Row = Record<string, unknown>;

export interface DebugFolder {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  revokedAt: string | null;
}

export function parseDebugValue<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    return debugStateInvalid();
  }
}

export function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : debugStateInvalid();
}

function number(value: unknown): number {
  return typeof value === "number" ? value : debugStateInvalid();
}

function bytes(value: unknown): Buffer {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return debugStateInvalid();
}

function parsedJson(value: unknown): unknown {
  try {
    return JSON.parse(text(value));
  } catch {
    return debugStateInvalid();
  }
}

export function sessionFromRow(row: Row): SessionSummary {
  return parseDebugValue(SessionSummarySchema, {
    id: row.id,
    folderId: row.folder_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function folderFromRow(row: Row): DebugFolder {
  return {
    id: text(row.id),
    name: text(row.display_name),
    rootPath: text(row.root_path),
    createdAt: text(row.created_at),
    revokedAt: nullableText(row.revoked_at),
  };
}

export function sessionDraftFromRow(row: Row): SessionDraft {
  return parseDebugValue(SessionDraftSchema, {
    sessionId: row.session_id,
    content: row.content,
    updatedAt: row.updated_at,
  });
}

export function attachmentFromRow(row: Row): AttachmentSummary {
  return parseDebugValue(AttachmentSummarySchema, {
    id: row.id,
    sessionId: row.session_id,
    name: row.display_name,
    mediaType: row.media_type,
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
}

export function messageFromRow(row: Row): ConversationMessage {
  return parseDebugValue(ConversationMessageSchema, {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    runId: row.run_id,
    createdAt: row.created_at,
  });
}

export function runFromRow(row: Row): { run: AgentRunSummary; traceVersion: number } {
  const performance =
    row.performance_json === null
      ? null
      : parseDebugValue(AgentRunPerformanceSchema, parsedJson(row.performance_json));
  return {
    run: parseDebugValue(AgentRunSummarySchema, {
      id: row.id,
      sessionId: row.session_id,
      jobId: row.job_id,
      state: row.state,
      response: row.response,
      error: row.error,
      performance,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
    traceVersion: number(row.trace_version),
  };
}

export function eventFromRow(row: Row): AgentEvent {
  return parseDebugValue(AgentEventSchema, {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    summary: row.summary,
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

export function executionFromRow(row: Row): AgentExecutionSnapshot {
  const stdout = bytes(row.stdout);
  const stderr = bytes(row.stderr);
  const diagnostics = text(row.vm_diagnostics_json);
  return parseDebugValue(AgentExecutionSnapshotSchema, {
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
    vmDiagnostics: parsedJson(diagnostics),
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
    vmDiagnosticsBytes: Buffer.byteLength(diagnostics),
    stdoutTruncated: row.stdout_truncated === 1,
    stderrTruncated: row.stderr_truncated === 1,
    vmDiagnosticsTruncated: row.vm_diagnostics_truncated === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  });
}

export function artifactFromRow(row: Row): AgentArtifactSummary {
  return parseDebugValue(AgentArtifactSummarySchema, {
    id: row.id,
    runId: row.run_id,
    name: row.display_name,
    mediaType: row.media_type,
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
}

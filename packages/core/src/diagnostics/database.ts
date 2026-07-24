import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  type AgentArtifactSummary,
  type AgentEvent,
  type AgentExecutionSnapshot,
  type AgentRunSummary,
  type AttachmentSummary,
  type ConversationMessage,
  type SessionDraft,
  SessionIdSchema,
  type SessionSummary,
} from "@vault/shared";
import { DebugSessionError, debugStateInvalid } from "./errors.js";
import { safeDatabasePath } from "./files.js";
import {
  artifactFromRow,
  attachmentFromRow,
  type DebugFolder,
  eventFromRow,
  executionFromRow,
  folderFromRow,
  messageFromRow,
  nullableText,
  parseDebugValue,
  type Row,
  runFromRow,
  sessionDraftFromRow,
  sessionFromRow,
  text,
} from "./records.js";

const CATALOG_SCHEMA_VERSION = 8;

export interface TraceTurnRecord extends Row {
  prompt_hash: string;
  schema_hash: string;
  response_hash: string | null;
}

export interface DebugRunRecords {
  run: AgentRunSummary;
  traceVersion: number;
  events: AgentEvent[];
  executions: AgentExecutionSnapshot[];
  artifacts: AgentArtifactSummary[];
  traceTurns: TraceTurnRecord[];
}

export interface DebugCatalogRecords {
  databasePath: string;
  internalRoot: string;
  schemaVersion: number;
  session: SessionSummary;
  folder: DebugFolder | null;
  draft: SessionDraft | null;
  attachments: AttachmentSummary[];
  messages: ConversationMessage[];
  runs: DebugRunRecords[];
}

function traceTurnFromRow(row: Row): TraceTurnRecord {
  return {
    ...row,
    prompt_hash: text(row.prompt_hash),
    schema_hash: text(row.schema_hash),
    response_hash: nullableText(row.response_hash),
  };
}

function readRun(database: DatabaseSync, row: Row): DebugRunRecords {
  const { run, traceVersion } = runFromRow(row);
  const all = (sql: string) => database.prepare(sql).all(run.id) as Row[];
  return {
    run,
    traceVersion,
    events: all("SELECT * FROM agent_events WHERE run_id = ? ORDER BY sequence").map(eventFromRow),
    executions: all("SELECT * FROM agent_executions WHERE run_id = ? ORDER BY sequence").map(
      executionFromRow,
    ),
    artifacts: all("SELECT * FROM agent_artifacts WHERE run_id = ? ORDER BY created_at, id").map(
      artifactFromRow,
    ),
    traceTurns: all("SELECT * FROM agent_inference_turns WHERE run_id = ? ORDER BY sequence").map(
      traceTurnFromRow,
    ),
  };
}

function catalogVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as Row;
  const version = Object.values(row)[0];
  if (version !== CATALOG_SCHEMA_VERSION) {
    throw new DebugSessionError("debug_schema_unsupported");
  }
  return version;
}

function sessionRow(database: DatabaseSync, sessionId: string): Row {
  const row = database.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as
    | Row
    | undefined;
  if (row === undefined) throw new DebugSessionError("debug_session_not_found");
  return row;
}

function relatedRows(
  database: DatabaseSync,
  table: "agent_runs" | "conversation_messages" | "session_attachments",
  sessionId: string,
): Row[] {
  return database
    .prepare(`SELECT * FROM ${table} WHERE session_id = ? ORDER BY created_at, id`)
    .all(sessionId) as Row[];
}

function readCatalog(
  database: DatabaseSync,
  databasePath: string,
  sessionId: string,
): DebugCatalogRecords {
  const schemaVersion = catalogVersion(database);
  const session = sessionFromRow(sessionRow(database, sessionId));
  const folderRow =
    session.folderId === null
      ? undefined
      : (database.prepare("SELECT * FROM folder_grants WHERE id = ?").get(session.folderId) as
          | Row
          | undefined);
  if (session.folderId !== null && folderRow === undefined) debugStateInvalid();
  const draftRow = database
    .prepare("SELECT * FROM session_drafts WHERE session_id = ?")
    .get(sessionId) as Row | undefined;
  return {
    databasePath,
    internalRoot: dirname(databasePath),
    schemaVersion,
    session,
    folder: folderRow === undefined ? null : folderFromRow(folderRow),
    draft: draftRow === undefined ? null : sessionDraftFromRow(draftRow),
    attachments: relatedRows(database, "session_attachments", sessionId).map(attachmentFromRow),
    messages: relatedRows(database, "conversation_messages", sessionId).map(messageFromRow),
    runs: relatedRows(database, "agent_runs", sessionId).map((row) => readRun(database, row)),
  };
}

export async function readDebugCatalog(
  requestedPath: string,
  requestedSessionId: string,
): Promise<DebugCatalogRecords> {
  const sessionId = parseDebugValue(SessionIdSchema, requestedSessionId);
  const databasePath = await safeDatabasePath(requestedPath);
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    readOnly: true,
    timeout: 5_000,
  });
  try {
    database.exec("BEGIN");
    const result = readCatalog(database, databasePath, sessionId);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original safe diagnostic.
    }
    if (error instanceof DebugSessionError) throw error;
    throw new DebugSessionError("debug_state_invalid");
  } finally {
    database.close();
  }
}

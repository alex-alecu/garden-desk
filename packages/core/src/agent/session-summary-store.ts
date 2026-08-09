import { type AgentSessionSummary, AgentSessionSummarySchema } from "@vault/shared";
import type { DatabasePort } from "../workspace/database.js";

interface SummaryRow {
  session_id: string;
  run_id: string;
  text: string;
  covered_message_id: string;
  covered_message_count: number;
  created_at: string;
}

function summary(row: SummaryRow): AgentSessionSummary {
  return AgentSessionSummarySchema.parse({
    sessionId: row.session_id,
    runId: row.run_id,
    text: row.text,
    coveredMessageId: row.covered_message_id,
    coveredMessageCount: row.covered_message_count,
    createdAt: row.created_at,
  });
}

/**
 * Stores one anchored summary per session. A later run reads the anchor, merges the
 * newly completed turns into it, and replaces it, so a long session keeps one evolving
 * continuity document instead of an unbounded chain.
 */
export class SessionSummaryStore {
  constructor(private readonly database: DatabasePort) {}

  load(sessionId: string): AgentSessionSummary | undefined {
    const row = this.database
      .prepare("SELECT * FROM agent_session_summaries WHERE session_id = ?")
      .get(sessionId) as SummaryRow | undefined;
    return row === undefined ? undefined : summary(row);
  }

  save(input: {
    sessionId: string;
    runId: string;
    text: string;
    coveredMessageId: string;
    coveredMessageCount: number;
  }): AgentSessionSummary {
    const record = AgentSessionSummarySchema.parse({
      ...input,
      createdAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        "INSERT INTO agent_session_summaries (session_id, run_id, text, covered_message_id, covered_message_count, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET run_id = excluded.run_id, text = excluded.text, covered_message_id = excluded.covered_message_id, covered_message_count = excluded.covered_message_count, created_at = excluded.created_at",
      )
      .run(
        record.sessionId,
        record.runId,
        record.text,
        record.coveredMessageId,
        record.coveredMessageCount,
        record.createdAt,
      );
    return record;
  }
}

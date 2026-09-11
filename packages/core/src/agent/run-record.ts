import { randomUUID } from "node:crypto";
import { type AgentRunSummary, AgentRunSummarySchema } from "@gardendesk/shared";
import type { DatabasePort } from "../workspace/database.js";

export function createRunRecord(
  database: DatabasePort,
  input: { sessionId: string; jobId: string; parentRunId: string | null } & Pick<
    AgentRunSummary,
    "agentId" | "assignment" | "parentToolCallId"
  >,
): AgentRunSummary {
  const now = new Date().toISOString();
  const result = AgentRunSummarySchema.parse({
    ...input,
    id: randomUUID(),
    state: "queued",
    response: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  database
    .prepare(
      "INSERT INTO agent_runs (id, session_id, parent_run_id, job_id, state, response, error, created_at, updated_at, performance_json, trace_version, agent_id, assignment, parent_tool_call_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
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
      result.agentId ?? null,
      result.assignment ?? null,
      result.parentToolCallId ?? null,
    );
  return result;
}

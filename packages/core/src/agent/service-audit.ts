import type { AgentRunSummary } from "@vault/shared";
import type { AuditLog } from "../audit/log.js";

export function appendSuccessfulRunAudit(
  audit: AuditLog,
  run: AgentRunSummary,
  guestExecutions: number,
): void {
  audit.append({
    type: "agent.completed",
    outcome: "succeeded",
    metadata: {
      runId: run.id,
      jobId: run.jobId,
      executions: guestExecutions,
    },
  });
}

import type { AgentRunSummary } from "@gardendesk/shared";
import type { AuditLog } from "../audit/log.js";

export function appendSuccessfulRunAudit(
  audit: AuditLog,
  run: AgentRunSummary,
  counts: { executions: number; guestExecutions: number },
): void {
  audit.append({
    type: "agent.completed",
    outcome: "succeeded",
    metadata: {
      runId: run.id,
      jobId: run.jobId,
      executions: counts.executions,
      guestExecutions: counts.guestExecutions,
    },
  });
}

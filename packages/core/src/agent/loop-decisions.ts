import type { AgentDecision, AgentExecutionResult } from "@vault/shared";

export function isDuplicateDecision(
  decision: Extract<AgentDecision, { action: "execute" }>,
  executions: AgentExecutionResult[],
): boolean {
  return executions.some((execution) =>
    decision.language === "shell"
      ? execution.command === decision.command
      : execution.source === decision.source,
  );
}

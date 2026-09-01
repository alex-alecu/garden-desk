import type { AgentExecutionResult } from "@gardendesk/shared";

export function isSuccessfulExecution(
  result: Pick<AgentExecutionResult, "exitCode" | "termination">,
): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}

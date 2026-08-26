import type { AgentExecutionResult } from "@vault/shared";

export function isSuccessfulExecution(
  result: Pick<AgentExecutionResult, "exitCode" | "termination">,
): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}

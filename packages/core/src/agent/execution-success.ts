import type { AgentExecutionResult } from "@vault/shared";

export function isSuccessfulExecution(result: AgentExecutionResult): boolean {
  return result.termination === "completed" && result.exitCode === 0;
}

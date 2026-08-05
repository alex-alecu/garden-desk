import type { AgentExecutionResult } from "@vault/shared";

export function requireGuestSuccess(result: AgentExecutionResult): void {
  if (result.exitCode !== 0 || result.termination !== "completed") {
    throw new Error(
      `Guest execution failed (${result.language}, ${result.exitCode}, ${result.termination}): ${result.stderr}\n${result.stdout}`,
    );
  }
}

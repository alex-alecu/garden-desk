import type { AgentExecutionResult } from "@vault/shared";
import { M3ProductCheckFailure } from "./m3-canonical-gate-reporting.js";

export function requireGuestSuccess(result: AgentExecutionResult): void {
  if (result.exitCode !== 0 || result.termination !== "completed") {
    throw new M3ProductCheckFailure(
      `Guest execution failed (${result.language}, ${result.exitCode}, ${result.termination}): ${result.stderr}\n${result.stdout}`,
    );
  }
}

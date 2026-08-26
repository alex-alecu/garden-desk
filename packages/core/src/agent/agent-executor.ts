import type { AgentExecutionResult, AgentExecutionSnapshot } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";

export type AgentScriptPreparationFailure =
  | "agent_script_missing"
  | "agent_script_invalid_text"
  | "agent_script_source_oversized";

const SCRIPT_PREPARATION_FAILURES = new Set<AgentScriptPreparationFailure>([
  "agent_script_missing",
  "agent_script_invalid_text",
  "agent_script_source_oversized",
]);

export function agentScriptPreparationFailure(
  error: unknown,
): AgentScriptPreparationFailure | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return SCRIPT_PREPARATION_FAILURES.has(message as AgentScriptPreparationFailure)
    ? (message as AgentScriptPreparationFailure)
    : undefined;
}

export class AgentExecutionAttemptError extends Error {
  constructor(
    message: string,
    readonly attempt: AgentExecutionSnapshot,
  ) {
    super(message);
    this.name = "AgentExecutionAttemptError";
  }
}

export interface AgentExecutor {
  execute(input: AgentSessionExecution, signal?: AbortSignal): Promise<AgentExecutionResult>;
  inspect?(input: AgentSessionExecution, signal?: AbortSignal): Promise<AgentExecutionResult>;
}

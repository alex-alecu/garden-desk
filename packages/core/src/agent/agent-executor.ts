import type { AgentExecutionResult } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";

export interface AgentExecutor {
  execute(input: AgentSessionExecution, signal?: AbortSignal): Promise<AgentExecutionResult>;
  inspect?(input: AgentSessionExecution, signal?: AbortSignal): Promise<AgentExecutionResult>;
}

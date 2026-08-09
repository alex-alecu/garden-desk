import type { AgentExecutionResult } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import type { AgentExecutor } from "./loop.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";

/**
 * Builds the run executor. Each execution is recorded before it starts and completed
 * from its terminal result, so durable execution records stay authoritative even when
 * the live stream is later compacted out of the prompt.
 */
export function createRunExecutor(input: {
  runId: string;
  sessionId: string;
  store: AgentStore;
  sessions: AgentSessionManager;
}): AgentExecutor {
  return {
    async execute(
      execution: AgentSessionExecution,
      signal?: AbortSignal,
    ): Promise<AgentExecutionResult> {
      const record = input.store.execution.create(input.runId, execution);
      const result = await input.sessions.execute(input.sessionId, execution, signal, {
        executionId: record.id,
        onUpdate: (update) => {
          if (update.kind === "stream") {
            input.store.execution.appendStream(record.id, update.stream, update.bytes);
            return;
          }
          input.store.execution.appendDiagnostic(record.id, update);
        },
      });
      input.store.execution.complete(record.id, result);
      return result;
    },
  };
}

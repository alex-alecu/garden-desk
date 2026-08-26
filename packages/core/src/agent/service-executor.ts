import { randomUUID } from "node:crypto";
import type { AgentExecutionResult } from "@vault/shared";
import type {
  AgentExecutionUpdate,
  AgentSessionExecution,
  ResolvedAgentSessionExecution,
} from "@vault/workers";
import type { AgentExecutor } from "./agent-executor.js";
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
  const append = (executionId: string, update: AgentExecutionUpdate): void => {
    if (update.kind === "stream") {
      input.store.execution.appendStream(executionId, update.stream, update.bytes);
      return;
    }
    input.store.execution.appendDiagnostic(executionId, update);
  };
  const run = async (
    execution: AgentSessionExecution,
    signal: AbortSignal | undefined,
    recorded: boolean,
  ): Promise<AgentExecutionResult> => {
    if (!recorded) return await input.sessions.execute(input.sessionId, execution, signal);
    const pathOnly = execution.language !== "shell" && execution.source === undefined;
    const executionId = randomUUID();
    let record = pathOnly
      ? undefined
      : input.store.execution.create(
          input.runId,
          execution as ResolvedAgentSessionExecution,
          executionId,
        );
    const pending: AgentExecutionUpdate[] = [];
    const result = await input.sessions.execute(input.sessionId, execution, signal, {
      executionId,
      async onPrepared(resolved) {
        if (record !== undefined) return;
        record = input.store.execution.create(input.runId, resolved, executionId);
        for (const update of pending.splice(0)) append(record.id, update);
      },
      onUpdate: (update) => {
        if (record === undefined) pending.push(update);
        else append(record.id, update);
      },
    });
    if (record === undefined) throw new Error("agent_execution_not_prepared");
    input.store.execution.complete(record.id, result);
    return result;
  };
  return {
    execute: async (execution, signal) => await run(execution, signal, true),
    inspect: async (execution, signal) => await run(execution, signal, false),
  };
}

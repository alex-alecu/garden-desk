import { randomUUID } from "node:crypto";
import type { AgentExecutionResult } from "@vault/shared";
import type {
  AgentExecutionUpdate,
  AgentSessionExecution,
  ResolvedAgentSessionExecution,
} from "@vault/workers";
import { AgentExecutionAttemptError, type AgentExecutor } from "./agent-executor.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";

interface RunExecutorInput {
  runId: string;
  sessionId: string;
  store: AgentStore;
  sessions: AgentSessionManager;
}

interface RecordingState {
  recordId: string | undefined;
  pending: AgentExecutionUpdate[];
}

function appendUpdate(store: AgentStore, executionId: string, update: AgentExecutionUpdate): void {
  if (update.kind === "stream") {
    store.execution.appendStream(executionId, update.stream, update.bytes);
    return;
  }
  store.execution.appendDiagnostic(executionId, update);
}

function prepareRecord(
  input: RunExecutorInput,
  state: RecordingState,
  resolved: ResolvedAgentSessionExecution,
  executionId: ReturnType<typeof randomUUID>,
): void {
  if (state.recordId !== undefined) return;
  state.recordId = input.store.execution.create(input.runId, resolved, executionId).id;
  for (const update of state.pending.splice(0)) {
    appendUpdate(input.store, state.recordId, update);
  }
}

function retainUpdate(
  input: RunExecutorInput,
  state: RecordingState,
  update: AgentExecutionUpdate,
) {
  if (state.recordId === undefined) state.pending.push(update);
  else appendUpdate(input.store, state.recordId, update);
}

function throwRecordedExecutionFailure(
  input: RunExecutorInput,
  state: RecordingState,
  signal: AbortSignal | undefined,
  error: unknown,
): never {
  if (state.recordId === undefined) throw error;
  input.store.execution.failIncomplete(input.runId, signal?.aborted === true);
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  const attempt = input.store.execution
    .list(input.runId)
    .find((item) => item.id === state.recordId);
  if (attempt === undefined) throw error;
  throw new AgentExecutionAttemptError(
    error instanceof Error ? error.message : String(error),
    attempt,
  );
}

async function runRecordedExecution(
  input: RunExecutorInput,
  execution: AgentSessionExecution,
  signal: AbortSignal | undefined,
): Promise<AgentExecutionResult> {
  const pathOnly = execution.language !== "shell" && execution.source === undefined;
  const executionId = randomUUID();
  const state: RecordingState = {
    recordId: pathOnly
      ? undefined
      : input.store.execution.create(
          input.runId,
          execution as ResolvedAgentSessionExecution,
          executionId,
        ).id,
    pending: [],
  };
  try {
    const result = await input.sessions.execute(input.sessionId, execution, signal, {
      executionId,
      onPrepared: (resolved) => prepareRecord(input, state, resolved, executionId),
      onUpdate: (update) => retainUpdate(input, state, update),
    });
    if (state.recordId === undefined) throw new Error("agent_execution_not_prepared");
    input.store.execution.complete(state.recordId, result);
    return result;
  } catch (error) {
    throwRecordedExecutionFailure(input, state, signal, error);
  }
}

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
  const run = async (
    execution: AgentSessionExecution,
    signal: AbortSignal | undefined,
    recorded: boolean,
  ): Promise<AgentExecutionResult> => {
    if (!recorded) return await input.sessions.execute(input.sessionId, execution, signal);
    return await runRecordedExecution(input, execution, signal);
  };
  return {
    execute: async (execution, signal) => await run(execution, signal, true),
    inspect: async (execution, signal) => await run(execution, signal, false),
  };
}

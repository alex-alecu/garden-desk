import { type AgentDecision, AgentExecutionResultSchema } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import type { AgentExecutor, AgentRunInput } from "./loop.js";
import type { RejectedExecutionReason } from "./loop-decisions.js";
import { executionCompletionSummary } from "./output-contract.js";
import type { AgentProgress } from "./prompt.js";

const MAX_CONSECUTIVE_DUPLICATES = 2;
const MAX_CONSECUTIVE_INVALID_PROGRAMS = 7;

export async function executeAgentDecision(
  executor: AgentExecutor,
  input: AgentRunInput,
  decision: Extract<AgentDecision, { action: "execute" }>,
  progress: AgentProgress,
): Promise<void> {
  const execution: AgentSessionExecution =
    decision.language === "shell"
      ? { language: "shell", command: decision.command }
      : {
          language: decision.language,
          path:
            decision.path ??
            `steps/${String(progress.executions.length + 1).padStart(4, "0")}.${decision.language === "python" ? "py" : "mjs"}`,
          source: decision.source,
        };
  input.onEvent?.("execution.started", decision.summary, {
    language: decision.language,
    path: execution.language === "shell" ? null : execution.path,
    source: decision.language === "shell" ? null : decision.source,
    command: decision.language === "shell" ? decision.command : null,
  });
  const result = await executor.execute(execution, input.signal);
  progress.executions.push(AgentExecutionResultSchema.parse(result));
  input.onEvent?.("execution.completed", executionCompletionSummary(result), {
    language: result.language,
    path: result.path,
    source: result.source,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    termination: result.termination,
  });
}

interface RejectedExecution {
  consecutive: number;
  reason: RejectedExecutionReason;
  turnId: string | undefined;
}

export function rejectExecution(
  input: AgentRunInput,
  progress: AgentProgress,
  rejection: RejectedExecution,
): number {
  if (rejection.turnId !== undefined) {
    input.trace?.store.recordOutcome(rejection.turnId, "rejected_duplicate");
  }
  progress.rejectedDuplicates += 1;
  progress.lastRejectedProgramReason = rejection.reason;
  if (rejection.reason === "shell_limit" || rejection.reason === "shell_source") {
    progress.sourceExecutionRequired = true;
  }
  const next = rejection.consecutive + 1;
  const limit =
    rejection.reason === "duplicate"
      ? MAX_CONSECUTIVE_DUPLICATES
      : MAX_CONSECUTIVE_INVALID_PROGRAMS;
  if (next >= limit) throw new Error("agent_stalled_duplicate");
  return next;
}

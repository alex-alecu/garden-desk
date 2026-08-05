import type { AgentRunResult } from "@vault/shared";
import { artifactCandidateNames } from "./artifact-declarations.js";
import type { AgentExecutor, AgentRunInput, TracedDecision } from "./loop.js";
import { rejectedExecutionReason } from "./loop-decisions.js";
import { executeAgentDecision, rejectExecution } from "./loop-execution.js";
import { finishRun, recordOutcome } from "./loop-outcomes.js";
import { type AgentProgress, executionBackedResponse } from "./prompt.js";
import { activePromptSkillNames } from "./prompt-content.js";
import { defaultPromptLibrary } from "./prompt-library.js";
import { progressEnabled } from "./prompt-progress.js";

export function activateRequestedSkills(
  input: AgentRunInput,
  progress: AgentProgress,
  traced: TracedDecision,
): boolean {
  const requested = traced.decision.skills ?? [];
  const library = input.promptLibrary ?? defaultPromptLibrary();
  if (requested.some((name) => !library.hasSkill(name))) throw new Error("agent_unknown_skill");
  const active = activePromptSkillNames(input, progress, library);
  const additions = requested.filter((name) => !active.has(name));
  if (additions.length === 0) return false;
  for (const name of additions) progress.requestedSkills?.add(name);
  recordOutcome(input, traced.turnId, "accepted_skill_request");
  return true;
}

export function newProgress(): AgentProgress {
  return {
    executions: [],
    inference: {
      promptTokens: 0,
      outputTokens: 0,
      promptDurationMs: 0,
      generationDurationMs: 0,
      totalDurationMs: 0,
    },
    rejectedDuplicates: 0,
    requestedSkills: new Set(),
  };
}

interface ExecuteTurnInput {
  consecutiveDuplicates: number;
  executor: AgentExecutor;
  input: AgentRunInput;
  progress: AgentProgress;
  traced: TracedDecision;
}

export interface ExecuteTurnResult {
  consecutiveDuplicates: number;
  result?: AgentRunResult;
}

export async function executeTurn(turn: ExecuteTurnInput): Promise<ExecuteTurnResult> {
  const { consecutiveDuplicates, executor, input, progress, traced } = turn;
  if (traced.decision.action === "respond") {
    recordOutcome(input, traced.turnId, "accepted_response");
    return {
      consecutiveDuplicates,
      result: finishRun(input, progress, traced.decision.response, traced.decision.artifacts ?? []),
    };
  }
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const rejection = rejectedExecutionReason(
    traced.decision,
    progress.executions,
    progressEnabled(input, progress, library),
    input.task,
  );
  if (rejection !== undefined) {
    return {
      consecutiveDuplicates: rejectExecution(input, progress, {
        consecutive: consecutiveDuplicates,
        reason: rejection,
        turnId: traced.turnId,
      }),
    };
  }
  progress.lastRejectedProgramReason = undefined;
  recordOutcome(input, traced.turnId, "accepted_execution", progress.executions.length);
  await executeAgentDecision(executor, input, traced.decision, progress);
  const active = activePromptSkillNames(input, progress, library);
  const verified = executionBackedResponse(input, progress, "");
  const result =
    active.size === 1 &&
    library.progressSkill(active) !== undefined &&
    verified.length > 0 &&
    artifactCandidateNames(progress.executions).length === 0
      ? finishRun(input, progress, verified)
      : undefined;
  return { consecutiveDuplicates: 0, ...(result === undefined ? {} : { result }) };
}

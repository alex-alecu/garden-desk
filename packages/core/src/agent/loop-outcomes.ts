import {
  type AgentInferenceOutcome,
  type AgentRunResult,
  AgentRunResultSchema,
} from "@vault/shared";
import type { AgentRunInput } from "./loop.js";
import { type AgentProgress, executionBackedResponse } from "./prompt.js";

export function recordOutcome(
  input: AgentRunInput,
  turnId: string | undefined,
  outcome: AgentInferenceOutcome,
  executionSequence?: number,
): void {
  if (turnId !== undefined) input.trace?.store.recordOutcome(turnId, outcome, executionSequence);
}

export function finishRun(
  input: AgentRunInput,
  progress: AgentProgress,
  response: string,
  artifacts: string[] = [],
): AgentRunResult {
  input.onEvent?.("assistant.completed", "Response completed.");
  return AgentRunResultSchema.parse({
    response: executionBackedResponse(input, progress, response),
    artifacts,
    ...progress,
  });
}

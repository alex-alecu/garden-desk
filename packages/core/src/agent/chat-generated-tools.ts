import type { AgentInferenceOutcome, ChatGenerationResult } from "@vault/shared";
import {
  applyDuplicateRecoveryDirection,
  DUPLICATE_RECOVERY_QUESTION,
  type ToolTurnOutcome,
} from "./chat-duplicate-recovery.js";
import type { ChatAgentInput, ChatRecoveryState } from "./chat-loop-input.js";
import type { ChatToolState } from "./chat-tool-turn.js";
import { executeToolCalls } from "./chat-tool-turn.js";
import type { GenericToolRegistry } from "./generic-tools.js";

interface GeneratedToolsInput {
  generated: ChatGenerationResult;
  input: ChatAgentInput;
  recovery: ChatRecoveryState;
  registry: GenericToolRegistry;
  state: ChatToolState;
  finalTurn: boolean;
  record(outcome: AgentInferenceOutcome): void;
  recoverContext(promptTokens: number): Promise<void>;
}

function rejectedDuplicate(options: GeneratedToolsInput): boolean {
  return options.generated.toolCalls.some((call) =>
    options.state.duplicateRecovery.omittedCallIds.has(call.id),
  );
}

async function requestRecoveryDirection(options: GeneratedToolsInput): Promise<void> {
  const ignoredDirection = options.state.duplicateRecovery.latestUserDirection !== undefined;
  if (ignoredDirection || options.input.askQuestion === undefined) {
    throw new Error("agent_stalled_duplicate");
  }
  const outcome = await options.input.askQuestion([DUPLICATE_RECOVERY_QUESTION]);
  applyDuplicateRecoveryDirection(options.state.duplicateRecovery, outcome);
}

export async function executeGeneratedTools(
  options: GeneratedToolsInput,
): Promise<ToolTurnOutcome> {
  const { input, state, registry, recovery, generated } = options;
  input.onResponse?.(null);
  let outcome: ToolTurnOutcome;
  try {
    outcome = await executeToolCalls(
      {
        registry,
        state,
        ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      },
      generated.toolCalls,
    );
  } catch (error) {
    options.record("accepted_tool_calls");
    throw error;
  }
  const duplicate = rejectedDuplicate(options);
  options.record(duplicate ? "rejected_duplicate" : "accepted_tool_calls");
  if (outcome.validInput) recovery.emptyResponsePending = false;
  if (options.finalTurn && options.state.duplicateRecovery.activeBlockedSignature !== undefined) {
    throw new Error("agent_stalled_duplicate");
  }
  await options.recoverContext(generated.performance.promptTokens);
  if (outcome.recoveryQuestionRequired) await requestRecoveryDirection(options);
  return outcome;
}

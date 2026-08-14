import type { ChatGenerationResult, ChatMessage } from "@vault/shared";
import type { ChatRecoveryState } from "./chat-loop-input.js";
import type { ChatToolState } from "./chat-tool-turn.js";

const COMPACTION_RATIO = 0.8;

interface OutputRecoveryInput {
  compact(): Promise<ChatMessage[]>;
  contextTokens: number;
  finalTurn: boolean;
  record(): void;
  recovery: ChatRecoveryState;
  result: ChatGenerationResult;
  state: ChatToolState;
}

export async function recoverOutputLimit(input: OutputRecoveryInput): Promise<boolean> {
  if (input.result.stopReason !== "maxTokens" || input.result.toolCalls.length > 0) return false;
  input.record();
  input.state.messages.pop();
  if (input.recovery.outputLimitRetryUsed || input.finalTurn) {
    throw new Error("agent_generation_limit");
  }
  input.recovery.outputLimitRetryUsed = true;
  if (input.result.performance.promptTokens >= input.contextTokens * COMPACTION_RATIO) {
    input.state.messages = await input.compact();
    input.state.checkpoint = input.state.messages.length;
  }
  input.state.messages.push({
    role: "system",
    text: "The previous turn reached its output limit and was discarded. Do not repeat extended reasoning. Make the next turn only one available typed tool call or one concise complete answer. Do not restate the plan or emit raw protocol text.",
  });
  return true;
}

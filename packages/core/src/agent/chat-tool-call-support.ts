import type { ChatToolCall } from "@vault/shared";
import { recoverJsonArrayBeforeProtocolTransition } from "./chat-protocol.js";
import type { AgentToolResult } from "./generic-tools.js";

export function blockedToolResult(message: string): AgentToolResult {
  return { content: message, failed: true };
}

export function invalidToolInputResult(message: string): AgentToolResult {
  return { content: message, failed: true, invalidInput: true };
}

export function alreadyLoadedSkillResult(name: string): AgentToolResult {
  return {
    content: `${name} skill is already loaded in the current context. Use its existing instructions.`,
    failed: false,
    status: "already_loaded",
  };
}

export function recoverQuestionCall(call: ChatToolCall): void {
  if (call.name !== "question" || typeof call.params !== "object" || call.params === null) return;
  const params = call.params as Record<string, unknown>;
  if (typeof params.questions !== "string") return;
  const questions = recoverJsonArrayBeforeProtocolTransition(params.questions);
  if (questions !== undefined) call.params = { ...params, questions };
}

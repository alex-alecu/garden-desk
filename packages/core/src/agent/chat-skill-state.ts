import type { ChatMessage, ChatToolCall } from "@vault/shared";

export type LoadedSkillCalls = Map<string, string>;

export function requestedSkillName(call: ChatToolCall): string | undefined {
  if (call.name !== "skill" || typeof call.params !== "object" || call.params === null) {
    return undefined;
  }
  const name = (call.params as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

export function liveLoadedSkillNames(
  loaded: LoadedSkillCalls,
  messages: readonly ChatMessage[],
): Set<string> {
  const liveCalls = new Set<string>();
  for (const message of messages) {
    if (message.role === "tool" && message.name === "skill") {
      liveCalls.add(message.toolCallId);
    }
  }
  for (const callId of loaded.keys()) {
    if (!liveCalls.has(callId)) loaded.delete(callId);
  }
  return new Set(loaded.values());
}

import type { ChatMessage } from "@vault/shared";

function serialized(message: ChatMessage): string {
  if (message.role === "assistant") {
    const calls = message.toolCalls.map(
      (call) => `[Assistant tool call ${call.name} ${call.id}]: ${JSON.stringify(call.params)}`,
    );
    return [`[Assistant]: ${message.text}`, ...calls].join("\n");
  }
  if (message.role === "tool") {
    return `[Tool result ${message.name} ${message.toolCallId}]: ${message.result.slice(0, 2_000)}`;
  }
  return `[${message.role === "user" ? "User" : "System"}]: ${message.text}`;
}

function retainedIndexes(messages: readonly ChatMessage[], assistantTurns: number): Set<number> {
  const retained = new Set<number>();
  const latestUser = messages.findLastIndex((message) => message.role === "user");
  if (latestUser >= 1) retained.add(latestUser);
  let found = 0;
  for (let index = messages.length - 1; index >= 1 && found < assistantTurns; index -= 1) {
    if (messages[index]?.role !== "assistant") continue;
    found += 1;
    for (let tail = index; tail < messages.length; tail += 1) retained.add(tail);
  }
  return retained;
}

export interface CompactHistoryResult {
  messages: ChatMessage[];
  summary: string;
}

export async function compactChatHistory(
  messages: readonly ChatMessage[],
  instructions: string,
  summarize: (prompt: string) => Promise<string>,
  options: { assistantTurns?: number } = {},
): Promise<CompactHistoryResult> {
  const assistantTurns = options.assistantTurns ?? 2;
  const retained = retainedIndexes(messages, assistantTurns);
  const previous = messages.find(
    (message) => message.role === "user" && message.text.startsWith("<anchored-summary>"),
  );
  const head = messages
    .slice(1)
    .filter(
      (message, index) =>
        message === previous || !retained.has(index + 1) || message.role === "user",
    );
  if (head.length === 0) return { messages: [...messages], summary: "" };
  const prompt = [
    previous?.role === "user"
      ? `Update the existing summary and preserve facts that remain true:\n${previous.text}`
      : "Create a new anchored summary.",
    instructions,
    "Conversation history:",
    head.map(serialized).join("\n\n"),
  ].join("\n\n");
  const summary = (await summarize(prompt)).trim();
  if (summary.length === 0) throw new Error("agent_compaction_empty");
  return {
    summary,
    messages: [
      messages[0] as ChatMessage,
      { role: "user", text: `<anchored-summary>\n${summary}\n</anchored-summary>` },
      ...messages.filter((_, index) => retained.has(index)),
    ],
  };
}

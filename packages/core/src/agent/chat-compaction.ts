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

export interface CompactionWorkspaceState {
  scriptPaths: readonly string[];
  lastExecutionFailure?: {
    termination: "completed" | "timeout" | "cancelled" | "resource_limit" | "crash";
    exitCode: number;
    errorText: string;
  };
}

function workspaceStateMessage(state: CompactionWorkspaceState): ChatMessage {
  const record = {
    scriptPaths: state.scriptPaths.slice(-8),
    lastExecutionFailure:
      state.lastExecutionFailure === undefined
        ? null
        : {
            ...state.lastExecutionFailure,
            errorText: state.lastExecutionFailure.errorText.slice(0, 400),
          },
  };
  return {
    role: "user",
    text: `<workspace-state>\n${JSON.stringify(record)}\n</workspace-state>`,
  };
}

export async function compactChatHistory(
  messages: readonly ChatMessage[],
  instructions: string,
  summarize: (prompt: string) => Promise<string>,
  options: { assistantTurns?: number; workspaceState?: CompactionWorkspaceState } = {},
): Promise<CompactHistoryResult> {
  const assistantTurns = options.assistantTurns ?? 2;
  const workspaceState = options.workspaceState;
  const retained = retainedIndexes(messages, assistantTurns);
  const previous = messages.find(
    (message) => message.role === "user" && message.text.startsWith("<anchored-summary>"),
  );
  const previousWorkspace = messages.find(
    (message) => message.role === "user" && message.text.startsWith("<workspace-state>"),
  );
  const head = messages.slice(1).filter((message, index) => {
    const absolute = index + 1;
    return (
      message !== previousWorkspace &&
      (message === previous || !retained.has(absolute) || message.role === "user")
    );
  });
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
      ...(workspaceState === undefined ? [] : [workspaceStateMessage(workspaceState)]),
      ...messages.filter((_, index) => retained.has(index)),
    ],
  };
}

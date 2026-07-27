import { parseXlsxProgress, xlsxContinuationMessage } from "@vault/shared";
import type { DurableAgentHistory } from "./history.js";

export interface ResolvedAgentTask {
  continuation: boolean;
  task: string;
}

function runId(run: DurableAgentHistory["runs"][number]): string | undefined {
  return run.events[0]?.runId;
}

function isContinuationQuestion(
  message: DurableAgentHistory["messages"][number],
  history: DurableAgentHistory,
): boolean {
  if (message.role !== "assistant" || message.runId === null) return false;
  const run = history.runs.findLast((candidate) => runId(candidate) === message.runId);
  const progress = run?.events
    .filter((event) => event.type === "execution.completed")
    .map((event) => parseXlsxProgress(event.stdout ?? ""))
    .filter((item) => item !== undefined && !item.complete)
    .at(-1);
  return progress !== undefined && message.content === xlsxContinuationMessage(progress);
}

function previousMessageIndex(
  messages: DurableAgentHistory["messages"],
  before: number,
  role: "assistant" | "user",
): number {
  return messages.findLastIndex((message, index) => index < before && message.role === role);
}

function isContinue(content: string): boolean {
  return content.trim().toLocaleLowerCase() === "continue";
}

function isContinuationQuestionAt(history: DurableAgentHistory, index: number): boolean {
  const message = history.messages[index];
  return message !== undefined && isContinuationQuestion(message, history);
}

function originalContinuationTask(history: DurableAgentHistory): string | undefined {
  let questionIndex = history.messages.length - 1;
  if (!isContinuationQuestionAt(history, questionIndex)) return undefined;
  while (questionIndex >= 0) {
    const userIndex = previousMessageIndex(history.messages, questionIndex, "user");
    const user = history.messages[userIndex];
    if (user === undefined) return undefined;
    if (!isContinue(user.content)) return user.content;
    questionIndex = previousMessageIndex(history.messages, userIndex, "assistant");
    if (!isContinuationQuestionAt(history, questionIndex)) return undefined;
  }
  return undefined;
}

export function resolveAgentTask(task: string, history: DurableAgentHistory): ResolvedAgentTask {
  if (!isContinue(task)) return { task, continuation: false };
  const original = originalContinuationTask(history);
  return original === undefined
    ? { task, continuation: false }
    : { task: original, continuation: true };
}

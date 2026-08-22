import { randomUUID } from "node:crypto";
import {
  type AgentSessionSummary,
  type ConversationMessage,
  JobIdSchema,
  MAX_ANCHORED_SUMMARY_CHARACTERS,
} from "@vault/shared";
import type { InferenceService } from "../runtime/inference.js";
import { withCurrentTimeContext } from "./chat-current-time.js";
import { canRetryInference } from "./chat-inference-recovery.js";
import type { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import type { AgentTraceStore } from "./trace-store.js";

const SUMMARY_OUTPUT_TOKENS = 2_048;
const MINIMUM_CONTEXT_TOKENS = 16_384;
const MINIMUM_SUMMARIZED_MESSAGES = 4;
const MAX_MESSAGE_CHARACTERS = 4_000;

function truncate(value: string): string {
  return value.length <= MAX_MESSAGE_CHARACTERS
    ? value
    : `${value.slice(0, MAX_MESSAGE_CHARACTERS)}\n[truncated]`;
}

function conversationText(messages: readonly ConversationMessage[]): string {
  return messages
    .map(
      (message) =>
        `[${message.role === "user" ? "User" : "Assistant"}]: ${truncate(message.content)}`,
    )
    .join("\n\n");
}

function prompt(input: SessionSummaryInput, messages: readonly ConversationMessage[]): string {
  const anchor = input.previous?.text
    ? `Update this existing anchored summary and preserve facts that remain true:\n<previous-summary>\n${input.previous.text}\n</previous-summary>`
    : "Create a new anchored summary.";
  return input.library
    .system("session-summary")
    .replace("{{anchor_instruction}}", anchor)
    .replace("{{conversation}}", conversationText(messages));
}

function estimatedTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export interface SessionSummaryInput {
  messages: readonly ConversationMessage[];
  modelId: string;
  contextTokens: number;
  previous?: AgentSessionSummary;
  library: MarkdownDefinitionLibrary;
  signal?: AbortSignal;
  trace?: { runId: string; store: AgentTraceStore };
}

export interface SessionSummaryResult {
  text: string;
  coveredMessageId: string;
  coveredMessageCount: number;
}

export interface SessionSummaryRefresh extends SessionSummaryInput {
  sessionId: string;
  runId: string;
  loadMessages: () => readonly ConversationMessage[];
  messages: readonly ConversationMessage[];
  store: {
    load(sessionId: string): AgentSessionSummary | undefined;
    save(input: {
      sessionId: string;
      runId: string;
      text: string;
      coveredMessageId: string;
      coveredMessageCount: number;
    }): AgentSessionSummary;
  };
}

export function summarizableMessages(
  messages: readonly ConversationMessage[],
  previous: AgentSessionSummary | undefined,
): readonly ConversationMessage[] {
  const covered =
    previous === undefined
      ? -1
      : messages.findIndex((message) => message.id === previous.coveredMessageId);
  return messages.slice(covered + 1);
}

export function fittedSummaryMessages(
  input: SessionSummaryInput,
  pending: readonly ConversationMessage[],
): readonly ConversationMessage[] {
  const budget = input.contextTokens - SUMMARY_OUTPUT_TOKENS;
  let selected = pending.length;
  while (selected >= MINIMUM_SUMMARIZED_MESSAGES) {
    if (estimatedTokens(prompt(input, pending.slice(0, selected))) <= budget) {
      return pending.slice(0, selected);
    }
    selected -= 1;
  }
  return [];
}

function summaryCandidate(input: SessionSummaryInput) {
  if (input.contextTokens < MINIMUM_CONTEXT_TOKENS) return undefined;
  const pending = summarizableMessages(input.messages, input.previous);
  if (pending.length < MINIMUM_SUMMARIZED_MESSAGES) return undefined;
  const selected = fittedSummaryMessages(input, pending);
  const last = selected.at(-1);
  return last === undefined ? undefined : { last, selected };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: retry and trace outcomes form one bounded summary transaction.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: retry and trace outcomes form one bounded summary transaction.
export async function summarizeSession(
  inference: Pick<InferenceService, "chat">,
  input: SessionSummaryInput,
): Promise<SessionSummaryResult | undefined> {
  const candidate = summaryCandidate(input);
  if (candidate === undefined) return undefined;
  const { last, selected } = candidate;
  const request = {
    modelId: input.modelId,
    messages: withCurrentTimeContext([
      { role: "system", text: "Produce only the requested anchored summary." },
      { role: "user", text: prompt(input, selected) },
    ]),
    tools: [],
    contextSize: "auto" as const,
    maxTokens: SUMMARY_OUTPUT_TOKENS,
    temperature: 0,
  };
  let retryUsed = false;
  while (true) {
    const identity = { requestId: randomUUID(), jobId: JobIdSchema.parse(randomUUID()) };
    const turnId = await input.trace?.store.begin(input.trace.runId, "compaction", {
      input: request,
      ...identity,
    });
    try {
      const generated = await inference.chat(request, input.signal, undefined, identity);
      const text = generated.text.trim().slice(0, MAX_ANCHORED_SUMMARY_CHARACTERS);
      if (turnId !== undefined) {
        await input.trace?.store.captureResponse(
          turnId,
          { text },
          generated.memory.contextSizeTokens,
        );
        input.trace?.store.recordOutcome(
          turnId,
          text.length === 0 ? "invalid_response" : "accepted_compaction",
        );
      }
      if (text.length === 0) return undefined;
      return {
        text,
        coveredMessageId: last.id,
        coveredMessageCount: input.messages.findIndex((message) => message.id === last.id) + 1,
      };
    } catch (error) {
      if (turnId !== undefined)
        input.trace?.store.recordOutcome(
          turnId,
          input.signal?.aborted ? "cancelled" : "inference_failed",
        );
      if (!canRetryInference(error, retryUsed, input.signal)) return undefined;
      retryUsed = true;
    }
  }
}

export async function refreshSessionSummary(
  inference: Pick<InferenceService, "chat">,
  refresh: Omit<SessionSummaryRefresh, "messages" | "previous">,
): Promise<AgentSessionSummary | undefined> {
  if (refresh.signal?.aborted) return undefined;
  const previous = refresh.store.load(refresh.sessionId);
  const summarized = await summarizeSession(inference, {
    ...refresh,
    messages: refresh.loadMessages(),
    ...(previous === undefined ? {} : { previous }),
  });
  return summarized === undefined
    ? undefined
    : refresh.store.save({ sessionId: refresh.sessionId, runId: refresh.runId, ...summarized });
}

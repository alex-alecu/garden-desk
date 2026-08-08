import {
  type AgentSessionSummary,
  type ConversationMessage,
  MAX_ANCHORED_SUMMARY_CHARACTERS,
} from "@vault/shared";
import type { InferenceService } from "../runtime/inference.js";
import { createGenerationRequest } from "../runtime/inference.js";
import type { PromptLibrary } from "./prompt-library.js";

const SUMMARY_OUTPUT_TOKENS = 1_024;
const MINIMUM_CONTEXT_TOKENS = 16_384;
const MINIMUM_SUMMARIZED_MESSAGES = 4;
const MAX_MESSAGE_CHARACTERS = 2_000;
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "array",
      items: { type: "string", maxLength: 512 },
      minItems: 1,
      maxItems: 40,
    },
  },
  required: ["summary"],
  additionalProperties: false,
} as const;

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

function anchorInstruction(previous: string | undefined): string {
  return previous === undefined
    ? "Create a new anchored summary from the conversation history."
    : `Update the anchored summary below using the conversation history. Preserve still-true details, remove stale details, and merge in new facts.\n\n<previous-summary>\n${previous}\n</previous-summary>`;
}

function summaryPrompt(input: SessionSummaryInput, messages: readonly ConversationMessage[]) {
  return input.library.system("session-summary", {
    anchor_instruction: anchorInstruction(input.previous?.text),
    conversation: conversationText(messages),
  });
}

function summaryRetryPrompt(input: SessionSummaryInput, prompt: string): string {
  return `${prompt}\n\n${input.library.recovery("session-summary-call")}`;
}

function summaryRequestTokens(
  input: SessionSummaryInput,
  messages: readonly ConversationMessage[],
) {
  return Math.ceil(
    JSON.stringify({
      modelId: input.modelId,
      prompt: summaryRetryPrompt(input, summaryPrompt(input, messages)),
      jsonSchema: SUMMARY_SCHEMA,
      contextSize: "auto",
      maxTokens: SUMMARY_OUTPUT_TOKENS,
    }).length / 4,
  );
}

function summaryFromValue(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("summary" in value)) return undefined;
  const lines = (value as { summary: unknown }).summary;
  if (!Array.isArray(lines)) return undefined;
  const text = lines
    .filter((line): line is string => typeof line === "string")
    .join("\n")
    .trim()
    .slice(0, MAX_ANCHORED_SUMMARY_CHARACTERS);
  return text.length === 0 ? undefined : text;
}

export interface SessionSummaryInput {
  messages: readonly ConversationMessage[];
  modelId: string;
  contextTokens: number;
  previous?: AgentSessionSummary | undefined;
  library: PromptLibrary;
  signal?: AbortSignal | undefined;
}

export interface SessionSummaryResult {
  text: string;
  coveredMessageId: string;
  coveredMessageCount: number;
}

export interface SessionSummaryRefresh {
  sessionId: string;
  runId: string;
  contextTokens: number;
  /**
   * Read lazily inside this module's failure boundary so a conversation-read failure
   * can never escape into an already-finalized run's error handling.
   */
  loadMessages: () => readonly ConversationMessage[];
  modelId: string;
  library: PromptLibrary;
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
  signal?: AbortSignal | undefined;
}

/**
 * Refreshes one session's anchored summary after a run reaches terminal state. It runs
 * outside the run transaction and swallows its own failures, so continuity prose can
 * never change a completed run's persisted outcome.
 */
export async function refreshSessionSummary(
  inference: Pick<InferenceService, "generate">,
  refresh: SessionSummaryRefresh,
): Promise<AgentSessionSummary | undefined> {
  if (refresh.signal?.aborted === true) return undefined;
  try {
    const summarized = await summarizeSession(inference, {
      messages: refresh.loadMessages(),
      modelId: refresh.modelId,
      contextTokens: refresh.contextTokens,
      previous: refresh.store.load(refresh.sessionId),
      library: refresh.library,
      signal: refresh.signal,
    });
    if (summarized === undefined) return undefined;
    return refresh.store.save({
      sessionId: refresh.sessionId,
      runId: refresh.runId,
      ...summarized,
    });
  } catch {
    return undefined;
  }
}

/**
 * Returns the messages this summary would newly cover. Summarizing is skipped while a
 * session is short enough for the existing history budget to carry it verbatim.
 */
export function summarizableMessages(
  messages: readonly ConversationMessage[],
  previous: AgentSessionSummary | undefined,
): readonly ConversationMessage[] {
  const anchored =
    previous === undefined
      ? -1
      : messages.findIndex((message) => message.id === previous.coveredMessageId);
  return messages.slice(anchored + 1);
}

/** Selects the largest pending prefix that fits the machine's current allocation. */
export function fittedSummaryMessages(
  input: SessionSummaryInput,
  pending: readonly ConversationMessage[],
): readonly ConversationMessage[] {
  const requestBudget = input.contextTokens - SUMMARY_OUTPUT_TOKENS;
  let low = MINIMUM_SUMMARIZED_MESSAGES;
  let high = pending.length;
  let selected = 0;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    if (summaryRequestTokens(input, pending.slice(0, candidate)) <= requestBudget) {
      selected = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  return pending.slice(0, selected);
}

/**
 * Produces one anchored conversation summary. The summary is untrusted continuity
 * prose: it never carries authoritative values and never decides completion. Any
 * failure returns undefined so the caller keeps its deterministic history fallback.
 */
export async function summarizeSession(
  inference: Pick<InferenceService, "generate">,
  input: SessionSummaryInput,
): Promise<SessionSummaryResult | undefined> {
  if (input.contextTokens < MINIMUM_CONTEXT_TOKENS) return undefined;
  const pending = summarizableMessages(input.messages, input.previous);
  if (pending.length < MINIMUM_SUMMARIZED_MESSAGES) return undefined;
  const selected = fittedSummaryMessages(input, pending);
  if (selected.length < MINIMUM_SUMMARIZED_MESSAGES) return undefined;
  const last = selected.at(-1);
  if (last === undefined) return undefined;
  const prompt = summaryPrompt(input, selected);
  try {
    const generate = async (effectivePrompt: string) => {
      const request = createGenerationRequest({
        modelId: input.modelId,
        prompt: effectivePrompt,
        jsonSchema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
        contextSize: "auto",
        maxTokens: SUMMARY_OUTPUT_TOKENS,
      });
      return await inference.generate(request.input, input.signal, undefined, request.identity);
    };
    let generated: Awaited<ReturnType<InferenceService["generate"]>>;
    try {
      generated = await generate(prompt);
    } catch (error) {
      if (!String(error).includes("structured_tool_call_required")) throw error;
      generated = await generate(summaryRetryPrompt(input, prompt));
    }
    const text = summaryFromValue(generated.value);
    if (text === undefined) return undefined;
    return {
      text,
      coveredMessageId: last.id,
      coveredMessageCount: input.messages.findIndex((message) => message.id === last.id) + 1,
    };
  } catch {
    // A failed summary is never fatal: history falls back to its deterministic excerpts.
    return undefined;
  }
}

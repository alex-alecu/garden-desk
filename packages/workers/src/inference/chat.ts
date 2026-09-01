import type { ChatGenerationRequest, ChatMessage, ChatToolCall } from "@gardendesk/shared";
import type {
  ChatHistoryItem,
  ChatModelFunctions,
  ChatModelResponse,
  LlamaChat,
  LlamaChatResponseChunk,
  Token,
} from "node-llama-cpp";
import { NativeToolCallCollector } from "./gemma-tool-call.js";

/**
 * Converts Core's owned conversation into the model's native chat history. Tool
 * calls and their results are folded back into the assistant/function-call shape
 * the Gemma wrapper serializes, so the model sees a faithful transcript of what it
 * previously requested and what the guest returned.
 */
export function toChatHistory(messages: readonly ChatMessage[]): ChatHistoryItem[] {
  const results = toolResults(messages);
  return messages.flatMap((message) => historyItem(message, results));
}

function toolResults(messages: readonly ChatMessage[]): Map<string, string> {
  return new Map(
    messages.flatMap((message) =>
      message.role === "tool" ? [[message.toolCallId, message.result] as const] : [],
    ),
  );
}

function historyItem(
  message: ChatMessage,
  results: ReadonlyMap<string, string>,
): ChatHistoryItem[] {
  switch (message.role) {
    case "system":
      return [{ type: "system", text: message.text }];
    case "user":
      return [{ type: "user", text: message.text }];
    case "assistant":
      return [{ type: "model", response: assistantResponse(message, results) }];
    case "tool":
      return [];
  }
}

function assistantResponse(
  message: Extract<ChatMessage, { role: "assistant" }>,
  results: ReadonlyMap<string, string>,
): ChatModelResponse["response"] {
  const response: ChatModelResponse["response"] = message.text.length > 0 ? [message.text] : [];
  for (const call of message.toolCalls) response.push(functionCall(call, results));
  return response.length > 0 ? response : [""];
}

function functionCall(call: ChatToolCall, results: ReadonlyMap<string, string>) {
  return {
    type: "functionCall" as const,
    name: call.name,
    params: call.params ?? {},
    result: parseResult(results.get(call.id)),
  };
}

function parseResult(result: string | undefined): unknown {
  if (result === undefined) return "";
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * Declares the requested tools to the model without executing anything: Core runs
 * every tool in the guest, so the worker handlers are never invoked. They exist only
 * so the chat wrapper renders the native declarations; the worker parses the calls.
 */
export function chatFunctions(request: ChatGenerationRequest): ChatModelFunctions {
  const functions: Record<string, { description: string; params: unknown }> = {};
  for (const tool of request.tools) {
    functions[tool.name] = { description: tool.description, params: tool.params };
  }
  return functions as ChatModelFunctions;
}

export interface ChatTurn {
  text: string;
  toolCalls: ChatToolCall[];
  stopReason: "toolCalls" | "text" | "maxTokens";
}

let toolCallCounter = 0;

export interface ChatGenerationCallbacks {
  onResponseChunk(chunk: LlamaChatResponseChunk): void;
  onToken(tokens: Token[]): void;
}

export async function generateChatTurn(
  request: ChatGenerationRequest,
  chat: LlamaChat,
  callbacks: ChatGenerationCallbacks,
  signal?: AbortSignal,
): Promise<ChatTurn> {
  const collector = new NativeToolCallCollector(chat.model);
  const result = await chat.generateResponse(toChatHistory(request.messages), {
    functions: chatFunctions(request),
    documentFunctionParams: true,
    maxTokens: request.maxTokens,
    budgets: { thoughtTokens: Math.min(1_024, Math.floor(request.maxTokens / 2)) },
    temperature: request.temperature,
    onResponseChunk(chunk) {
      if (chunk.type !== undefined) return callbacks.onResponseChunk(chunk);
      const text = collector.push(chunk.tokens, chunk.text);
      if (text.length > 0) callbacks.onResponseChunk({ ...chunk, text });
    },
    onToken: callbacks.onToken,
    ...(signal === undefined ? {} : { signal }),
  });
  const turn = collector.finish(result.response);
  const toolCalls: ChatToolCall[] = [];
  if (turn.call !== undefined) {
    toolCallCounter += 1;
    toolCalls.push({
      id: `call_${Date.now().toString(36)}_${toolCallCounter.toString(36)}`,
      name: turn.call.name,
      params: turn.call.params,
    });
  }
  const stopReason =
    result.metadata.stopReason === "maxTokens"
      ? "maxTokens"
      : toolCalls.length > 0
        ? "toolCalls"
        : "text";
  return { text: turn.text, toolCalls, stopReason };
}

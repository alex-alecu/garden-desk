import type { ChatGenerationRequest, ChatMessage, ChatToolCall } from "@vault/shared";
import type {
  ChatHistoryItem,
  ChatModelFunctions,
  ChatModelResponse,
  LlamaChat,
  LlamaChatResponseChunk,
  Token,
} from "node-llama-cpp";

const NATIVE_GRAMMAR_MAX_REPETITIONS = 1_999;

function grammarSafeToolParams(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(grammarSafeToolParams);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([name, item]) =>
      name === "maxLength" &&
      typeof item === "number" &&
      Math.floor(item) >= NATIVE_GRAMMAR_MAX_REPETITIONS + 1
        ? []
        : [[name, grammarSafeToolParams(item)]],
    ),
  );
}

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
 * so the chat wrapper emits the function schema and can parse the model's calls.
 */
export function chatFunctions(request: ChatGenerationRequest): ChatModelFunctions {
  const functions: Record<string, { description: string; params: unknown }> = {};
  for (const tool of request.tools) {
    functions[tool.name] = {
      description: tool.description,
      params: grammarSafeToolParams(tool.params),
    };
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
  const functions = chatFunctions(request);
  const result = await chat.generateResponse(toChatHistory(request.messages), {
    functions,
    documentFunctionParams: true,
    maxParallelFunctionCalls: 4,
    maxTokens: request.maxTokens,
    budgets: { thoughtTokens: Math.min(1_024, Math.floor(request.maxTokens / 2)) },
    temperature: request.temperature,
    onResponseChunk: callbacks.onResponseChunk,
    onToken: callbacks.onToken,
    ...(signal === undefined ? {} : { signal }),
  });
  const calls = result.functionCalls ?? [];
  const toolCalls: ChatToolCall[] = calls.map((call) => {
    toolCallCounter += 1;
    return {
      id: `call_${Date.now().toString(36)}_${toolCallCounter.toString(36)}`,
      name: String(call.functionName),
      params: call.params ?? {},
    };
  });
  const stopReason =
    result.metadata.stopReason === "maxTokens"
      ? "maxTokens"
      : toolCalls.length > 0
        ? "toolCalls"
        : "text";
  return { text: result.response, toolCalls, stopReason };
}

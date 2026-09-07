import type {
  ChatGenerationRequest,
  ChatMessage,
  InferencePerformance,
  StructuredGenerationRequest,
} from "@gardendesk/shared";
import type { NativeWorkerHandle } from "../native/launcher.js";
import { ServerError, serverRequest } from "./server-http.js";

interface ToolDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface ChatEvent {
  choices?: Array<{
    delta?: { content?: string; reasoning_content?: string; tool_calls?: ToolDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
  timings?: { prompt_n: number; prompt_ms: number; predicted_n: number; predicted_ms: number };
}
export interface ChatStreams {
  reasoning?: Map<string, string>;
  onThinkingDelta?(text: string): void;
  onResponseDelta?(text: string): void;
}

export function serverMessages(
  messages: ChatMessage[],
  reasoning?: Map<string, string>,
): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool")
      return { role: "tool", tool_call_id: message.toolCallId, content: message.result };
    if (message.role !== "assistant") return { role: message.role, content: message.text };
    const retained = reasoning?.get(message.toolCalls[0]?.id ?? "");
    return {
      role: "assistant",
      content: message.text,
      ...(retained === undefined ? {} : { reasoning_content: retained }),
      ...(message.toolCalls.length === 0
        ? {}
        : {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.params) },
            })),
          }),
    };
  });
}

interface Reply {
  text: string;
  reasoning: string;
  calls: Map<number, { id: string; name: string; arguments: string }>;
  usage: ChatEvent["usage"];
  timings: ChatEvent["timings"];
  finish: string | null | undefined;
}

function appendTools(reply: Reply, parts: ToolDelta[]) {
  for (const part of parts) {
    const call = reply.calls.get(part.index) ?? { id: "", name: "", arguments: "" };
    call.id += part.id ?? "";
    call.name += part.function?.name ?? "";
    call.arguments += part.function?.arguments ?? "";
    reply.calls.set(part.index, call);
  }
}

function appendEvent(reply: Reply, event: ChatEvent, streams: ChatStreams) {
  const choice = event.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content) {
    reply.text += delta.content;
    streams.onResponseDelta?.(delta.content);
  }
  if (delta?.reasoning_content) {
    reply.reasoning += delta.reasoning_content;
    streams.onThinkingDelta?.(delta.reasoning_content);
  }
  appendTools(reply, delta?.tool_calls ?? []);
  reply.usage = event.usage ?? reply.usage;
  reply.timings = event.timings ?? reply.timings;
  reply.finish = choice?.finish_reason ?? reply.finish;
}

function result(reply: Reply, streams: ChatStreams, began: number) {
  const { usage, timings } = reply;
  if (usage === undefined || timings === undefined)
    throw new ServerError("malformed_worker_message");
  const toolCalls = [...reply.calls.values()].map((call) => ({
    id: call.id,
    name: call.name,
    params: JSON.parse(call.arguments) as unknown,
  }));
  if (toolCalls[0] !== undefined && reply.reasoning.length > 0)
    streams.reasoning?.set(toolCalls[0].id, reply.reasoning);
  const performance: InferencePerformance = {
    promptTokens: timings.prompt_n,
    outputTokens: timings.predicted_n,
    promptDurationMs: Math.round(timings.prompt_ms),
    generationDurationMs: Math.round(timings.predicted_ms),
    totalDurationMs: Date.now() - began,
  };
  return {
    text: reply.text,
    toolCalls,
    performance,
    contextUsedTokens: usage.prompt_tokens + usage.completion_tokens,
    stopReason:
      toolCalls.length > 0
        ? ("toolCalls" as const)
        : reply.finish === "length"
          ? ("maxTokens" as const)
          : ("text" as const),
  };
}

export async function completeChat(
  handle: NativeWorkerHandle,
  body: Record<string, unknown>,
  signal: AbortSignal,
  streams: ChatStreams = {},
) {
  const began = Date.now();
  const reply: Reply = {
    text: "",
    reasoning: "",
    calls: new Map(),
    usage: undefined,
    timings: undefined,
    finish: undefined,
  };
  await serverRequest(
    handle,
    "/v1/chat/completions",
    { ...body, stream: true, stream_options: { include_usage: true }, cache_prompt: true },
    {
      signal,
      onEvent: (event) => appendEvent(reply, event as ChatEvent, streams),
    },
  );
  return result(reply, streams, began);
}

export function chatBody(
  request: ChatGenerationRequest | StructuredGenerationRequest,
  streams: ChatStreams,
) {
  return {
    messages:
      request.operation === "chat"
        ? serverMessages(request.messages, streams.reasoning)
        : [{ role: "user", content: request.prompt }],
    max_tokens: request.maxTokens,
    temperature: request.operation === "chat" ? request.temperature : 0,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    presence_penalty: 0,
    repeat_penalty: 1,
    reasoning_budget_tokens: Math.min(1024, Math.floor(request.maxTokens / 2)),
    chat_template_kwargs: { preserve_thinking: false },
    ...(request.operation === "generate"
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "result", schema: request.jsonSchema, strict: true },
          },
        }
      : request.tools.length === 0
        ? {}
        : {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.params },
            })),
            tool_choice: "auto",
          }),
  };
}

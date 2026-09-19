import {
  type ChatGenerationRequest,
  ChatGenerationRequestSchema,
  fittedContextTokens,
  StructuredGenerationRequestSchema,
} from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { chatBody } from "./server-chat.js";
import { serverArguments } from "./server-runtime.js";

const request = {
  protocolVersion: 2,
  requestId: "00000000-0000-4000-8000-000000000000",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "generate",
  modelId: "qwen3.8-27b-ud-iq4_xs",
  prompt: "Respond.",
  jsonSchema: { type: "object" },
  maxTokens: 1,
} as const;

describe("generation context contract", () => {
  it("accepts automatic context and the model maximum", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: "auto" }).success,
    ).toBe(true);
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 262_144 }).success,
    ).toBe(true);
  });

  it("rejects explicit generation context above the model maximum", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 262_145 }).success,
    ).toBe(false);
  });
});

it("sends the selected thinking level as the reasoning effort with its thinking budget", () => {
  const chat = (thinking: ChatGenerationRequest["thinking"]) =>
    ChatGenerationRequestSchema.parse({
      ...request,
      operation: "chat",
      prompt: undefined,
      jsonSchema: undefined,
      contextSize: "auto",
      messages: [{ role: "user", text: "Respond." }],
      tools: [],
      temperature: 0,
      thinking,
    });
  expect(chatBody(chat("medium"), {})).toMatchObject({
    chat_template_kwargs: { preserve_thinking: false, reasoning_effort: "medium" },
    thinking_budget_tokens: 2048,
  });
  expect(chatBody(chat("xhigh"), {}).thinking_budget_tokens).toBe(8192);
  expect(chatBody(chat("none"), {}).chat_template_kwargs).toEqual({
    preserve_thinking: false,
    enable_thinking: false,
  });
  expect(Object.keys(chatBody(chat("none"), {}))).not.toContain("thinking_budget_tokens");
});

it("uses the model card sampling values and the reasoning guardrail", () => {
  const chat = (thinking: ChatGenerationRequest["thinking"]) =>
    ChatGenerationRequestSchema.parse({
      ...request,
      operation: "chat",
      prompt: undefined,
      jsonSchema: undefined,
      contextSize: "auto",
      messages: [{ role: "user", text: "Respond." }],
      tools: [],
      temperature: 1,
      thinking,
    });
  expect(chatBody(chat("medium"), {})).toMatchObject({
    temperature: 1,
    top_p: 0.95,
    top_k: 20,
    min_p: 0,
    presence_penalty: 0,
    repeat_penalty: 1,
  });
  expect(chatBody(chat("none"), {})).toMatchObject({
    temperature: 0.7,
    top_p: 0.8,
    presence_penalty: 1.5,
  });
  const structured = StructuredGenerationRequestSchema.parse({ ...request, contextSize: "auto" });
  expect(chatBody(structured, {}).temperature).toBe(0);
  const args = serverArguments({
    backend: "metal",
    modelPath: "model.gguf",
    contextTokens: 32768,
    speculation: "none",
  });
  expect(args[args.indexOf("--reasoning-budget") + 1]).toBe("32768");
});

it("uses the Metal buffer name accepted by the pinned server", () => {
  const args = serverArguments({
    backend: "metal",
    modelPath: "model.gguf",
    contextTokens: 32768,
    speculation: "none",
  });
  expect(args[args.indexOf("--override-tensor") + 1]).toBe(".*=MTL0");
});

it("uses matching cache types for Metal Flash Attention", () => {
  const args = serverArguments({
    backend: "metal",
    modelPath: "model.gguf",
    contextTokens: 32768,
    speculation: "none",
  });
  expect(args[args.indexOf("--cache-type-k") + 1]).toBe(args[args.indexOf("--cache-type-v") + 1]);
});

it("fits the context to the memory budget between the minimum and the model maximum", () => {
  const fit = { memoryBudgetBytes: 16 * 1024 ** 3, modelByteLength: 7_206_168_928 };
  expect(fittedContextTokens({ ...fit, cacheType: "q4_0" })).toBe(262_144);
  expect(fittedContextTokens({ ...fit, cacheType: "q8_0" })).toBe(208_896);
  expect(fittedContextTokens({ ...fit, memoryBudgetBytes: 8 * 1024 ** 3, cacheType: "q4_0" })).toBe(
    32_768,
  );
});

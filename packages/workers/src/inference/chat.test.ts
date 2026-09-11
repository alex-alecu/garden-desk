import { type ChatGenerationRequest, JobIdSchema } from "@gardendesk/shared";
import type { LlamaChat } from "node-llama-cpp";
import { describe, expect, it, vi } from "vitest";
import { chatFunctions, generateChatTurn, toChatHistory } from "./chat.js";

describe("native chat history", () => {
  it("folds tool results into the originating assistant function call", () => {
    const history = toChatHistory([
      { role: "system", text: "System" },
      { role: "user", text: "Inspect" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "call-1", name: "read", params: { path: "/source/a.txt" } }],
      },
      { role: "tool", toolCallId: "call-1", name: "read", result: "1: value" },
    ]);

    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({
      type: "model",
      response: [
        {
          type: "functionCall",
          name: "read",
          params: { path: "/source/a.txt" },
          result: "1: value",
        },
      ],
    });
  });

  it("passes Core tool schemas through without handlers", () => {
    const request = {
      protocolVersion: 2,
      requestId: "test",
      jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      operation: "chat",
      modelId: "test",
      messages: [{ role: "user", text: "List" }],
      tools: [
        {
          name: "list",
          description: "List paths.",
          params: { type: "object", properties: {} },
        },
      ],
      contextSize: 8_192,
      maxTokens: 1_024,
      temperature: 0,
    } satisfies ChatGenerationRequest;
    expect(chatFunctions(request)).toMatchObject({
      list: { description: "List paths.", params: { type: "object", properties: {} } },
    });
  });
});

describe("full prompt context", () => {
  it("rejects a full prompt that cannot fit with its output reserve", async () => {
    const generateResponse = vi.fn(async () => ({
      response: "",
      metadata: { stopReason: "eogToken" },
    }));
    const tokenize = vi.fn(() => [1, 2, 3, 4, 5, 6, 7]);
    const chat = {
      model: { tokenizer: vi.fn(), tokenize: vi.fn(() => [1]), detokenize: vi.fn(() => "") },
      sequence: { contextSize: 10 },
      chatWrapper: {
        generateContextState: vi.fn(() => ({ contextText: { tokenize } })),
      },
      generateResponse,
    } as unknown as LlamaChat;
    const request = {
      protocolVersion: 2,
      requestId: "test",
      jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      operation: "chat",
      modelId: "test",
      messages: [{ role: "user", text: "Review" }],
      tools: [],
      contextSize: 8_192,
      maxTokens: 4,
      temperature: 0,
      fullPrompt: true,
    } as ChatGenerationRequest;

    await expect(
      generateChatTurn(request, chat, { onResponseChunk: vi.fn(), onToken: vi.fn() }),
    ).rejects.toThrow("full_prompt_context_limit");
    expect(generateResponse).not.toHaveBeenCalled();
    expect(chat.chatWrapper.generateContextState).toHaveBeenCalledWith({
      chatHistory: [
        { type: "user", text: "Review" },
        { type: "model", response: [] },
      ],
      availableFunctions: {},
      documentFunctionParams: true,
    });
    expect(tokenize).toHaveBeenCalledWith(chat.model.tokenizer);
  });
});

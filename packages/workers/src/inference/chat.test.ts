import { type ChatGenerationRequest, JobIdSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { chatFunctions, toChatHistory } from "./chat.js";

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

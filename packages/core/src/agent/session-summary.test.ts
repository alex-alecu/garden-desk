import { resolve } from "node:path";
import type { ChatGenerationResult, ConversationMessage } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { ChatInput, InferenceService } from "../runtime/inference.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { summarizableMessages, summarizeSession } from "./session-summary.js";

const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));

function messages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as ConversationMessage["id"],
    sessionId: "00000000-0000-4000-8000-000000000100" as ConversationMessage["sessionId"],
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    runId: null,
    createdAt: new Date(index).toISOString(),
  }));
}

function result(text: string): ChatGenerationResult {
  return {
    protocolVersion: 1,
    requestId: "test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuVramBytes: 1,
      budgetBytes: 2,
      detectedGpuVramBytes: 1,
      contextSizeTokens: 16_384,
    },
    performance: {
      promptTokens: 10,
      outputTokens: 4,
      promptDurationMs: 1,
      generationDurationMs: 1,
      totalDurationMs: 2,
    },
  };
}

describe("session summary", () => {
  it("waits until four new messages exist", async () => {
    const chat = vi.fn(async (_input: ChatInput) => result("unused"));
    expect(
      await summarizeSession({ chat } as Pick<InferenceService, "chat">, {
        messages: messages(3),
        modelId: "model",
        contextTokens: 16_384,
        library,
      }),
    ).toBeUndefined();
    expect(chat).not.toHaveBeenCalled();
  });

  it("creates an anchored Markdown summary with no tools", async () => {
    const chat = vi.fn(async (_input: ChatInput) => result("## Objective\n- Continue"));
    const summary = await summarizeSession({ chat } as Pick<InferenceService, "chat">, {
      messages: messages(4),
      modelId: "model",
      contextTokens: 16_384,
      library,
    });
    expect(summary?.text).toContain("## Objective");
    expect(chat.mock.calls[0]?.[0].tools).toEqual([]);
    expect(chat.mock.calls[0]?.[0].contextSize).toBe("auto");
  });

  it("selects only messages after the previous anchor", () => {
    const items = messages(6);
    const first = items[0];
    const third = items[2];
    if (first === undefined || third === undefined) throw new Error("missing_fixture_message");
    expect(
      summarizableMessages(items, {
        sessionId: first.sessionId,
        runId: "00000000-0000-4000-8000-000000000200" as never,
        text: "old",
        coveredMessageId: third.id,
        coveredMessageCount: 3,
        createdAt: new Date().toISOString(),
      }),
    ).toEqual(items.slice(3));
  });
});

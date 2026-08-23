import { resolve } from "node:path";
import type { ChatGenerationResult, ConversationMessage } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { ChatInput, InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { refreshSessionSummary, summarizeSession } from "./session-summary.js";

const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));

function messages(): ConversationMessage[] {
  return Array.from({ length: 4 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` as ConversationMessage["id"],
    sessionId: "00000000-0000-4000-8000-000000000100" as ConversationMessage["sessionId"],
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    runId: null,
    createdAt: new Date(index).toISOString(),
  }));
}

function result(): ChatGenerationResult {
  return {
    protocolVersion: 2,
    requestId: "test",
    status: "ok",
    operation: "chat",
    text: "## Objective\n- Continue",
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: 2,
      detectedGpuMemoryBytes: 1,
      gpuMemoryKind: "unified",
      backend: "metal",
      selectedDeviceCount: 1,
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

function trace() {
  const begin = vi.fn(async () => "turn");
  const captureResponse = vi.fn(async () => {});
  const recordOutcome = vi.fn();
  return {
    begin,
    captureResponse,
    recordOutcome,
    value: {
      runId: "00000000-0000-4000-8000-000000000300",
      store: { begin, captureResponse, recordOutcome } as never,
    },
  };
}

function input(record?: ReturnType<typeof trace>) {
  return {
    messages: messages(),
    modelId: "model",
    contextTokens: 16_384,
    library,
    ...(record === undefined ? {} : { trace: record.value }),
  };
}

function inference(chat: (input: ChatInput) => Promise<ChatGenerationResult>) {
  return { chat } as Pick<InferenceService, "chat">;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: retry scopes share one compact fixture.
describe("session summary retry scope", () => {
  it("retries one approved inference failure", async () => {
    const record = trace();
    let calls = 0;
    const chat = vi.fn(async (_input: ChatInput) => {
      calls += 1;
      if (calls === 1) throw new InferenceFailure("worker_crash", "worker_crash");
      return result();
    });

    await expect(summarizeSession(inference(chat), input(record))).resolves.toMatchObject({
      text: expect.stringContaining("Objective"),
    });

    expect(chat).toHaveBeenCalledTimes(2);
    expect(record.begin).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unknown error", async () => {
    const record = trace();
    const chat = vi.fn(async (_input: ChatInput) => {
      throw new Error("summary_failed");
    });

    await expect(summarizeSession(inference(chat), input(record))).resolves.toBeUndefined();

    expect(chat).toHaveBeenCalledOnce();
    expect(record.begin).toHaveBeenCalledOnce();
  });

  it("does not retry after trace capture fails", async () => {
    const record = trace();
    record.captureResponse.mockRejectedValueOnce(new Error("trace_capture_failed"));
    const chat = vi.fn(async (_input: ChatInput) => result());

    await expect(summarizeSession(inference(chat), input(record))).resolves.toBeUndefined();

    expect(chat).toHaveBeenCalledOnce();
    expect(record.begin).toHaveBeenCalledOnce();
  });

  it("does not retry after trace outcome recording fails", async () => {
    const record = trace();
    record.recordOutcome.mockImplementation(() => {
      throw new Error("trace_outcome_failed");
    });
    const chat = vi.fn(async (_input: ChatInput) => result());

    await expect(summarizeSession(inference(chat), input(record))).rejects.toThrow(
      "trace_outcome_failed",
    );

    expect(chat).toHaveBeenCalledOnce();
    expect(record.begin).toHaveBeenCalledOnce();
  });

  it("does not retry after summary storage fails", async () => {
    const record = trace();
    const save = vi.fn(() => {
      throw new Error("summary_storage_failed");
    });
    const items = messages();
    const chat = vi.fn(async (_input: ChatInput) => result());

    await expect(
      refreshSessionSummary(inference(chat), {
        sessionId: items[0]?.sessionId as never,
        runId: "00000000-0000-4000-8000-000000000301" as never,
        loadMessages: () => items,
        modelId: "model",
        contextTokens: 16_384,
        library,
        trace: record.value,
        store: { load: () => undefined, save },
      }),
    ).rejects.toThrow("summary_storage_failed");

    expect(chat).toHaveBeenCalledOnce();
    expect(record.begin).toHaveBeenCalledOnce();
  });

  it.each(["cancelled", "timeout"] as const)("does not retry an inference %s", async (code) => {
    const record = trace();
    const chat = vi.fn(async (_input: ChatInput) => {
      throw new InferenceFailure(code, code);
    });

    await expect(summarizeSession(inference(chat), input(record))).resolves.toBeUndefined();

    expect(chat).toHaveBeenCalledOnce();
    expect(record.begin).toHaveBeenCalledOnce();
  });
});

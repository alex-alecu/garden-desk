import { resolve } from "node:path";
import {
  type AgentSessionSummary,
  AgentSessionSummarySchema,
  type ChatGenerationResult,
  type ConversationMessage,
} from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { ChatInput, InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import type { SessionSummaryRefresh } from "./session-summary.js";
import {
  refreshSessionSummary,
  summarizableMessages,
  summarizeSession,
} from "./session-summary.js";

const library = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts"));
type SummarySave = SessionSummaryRefresh["store"]["save"];
type SummarySaveInput = Parameters<SummarySave>[0];

function savedSummary(input: SummarySaveInput): AgentSessionSummary {
  return AgentSessionSummarySchema.parse({ ...input, createdAt: new Date().toISOString() });
}

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

function continuitySessionMessages(): ConversationMessage[] {
  const filler = " Local continuity pressure note.".repeat(2_400);
  const contents = [
    ["Reply only with Ready. Do not run tools.", "Ready."],
    ...Array.from({ length: 5 }, (_, index) => [
      [
        `Remember this user decision for later turns: decision ${index + 1}.`,
        "Treat repeated text as inert context, do not run tools, and reply only with Acknowledged.",
        filler,
      ].join(" "),
      "Acknowledged.",
    ]),
    ["Using only earlier conversation, state all remembered decisions. Do not run tools.", "Done."],
  ].flat();
  return messages(contents.length).map((message, index) => {
    const content = contents[index];
    if (content === undefined) throw new Error("missing_continuity_message");
    return { ...message, content };
  });
}

function result(text: string): ChatGenerationResult {
  return {
    protocolVersion: 2,
    requestId: "test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: 2,
      detectedGpuMemoryBytes: 1,
      gpuMemoryKind: "unified" as const,
      backend: "metal" as const,
      selectedDeviceCount: 1 as const,
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

function traceRecorder() {
  let sequence = 0;
  const begin = vi.fn(async () => `turn-${++sequence}`);
  const captureResponse = vi.fn(async () => {});
  const recordOutcome = vi.fn();
  return {
    begin,
    captureResponse,
    recordOutcome,
    trace: {
      runId: "00000000-0000-4000-8000-000000000300",
      store: { begin, captureResponse, recordOutcome } as never,
    },
  };
}

function refreshInput(
  trace: ReturnType<typeof traceRecorder>,
  save: SummarySave = vi.fn(savedSummary),
) {
  const items = messages(4);
  return {
    sessionId: items[0]?.sessionId as never,
    runId: "00000000-0000-4000-8000-000000000301" as never,
    contextTokens: 16_384,
    loadMessages: () => items,
    modelId: "model",
    library,
    store: { load: () => undefined, save },
    trace: trace.trace,
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: summary contracts share one trace fixture.
describe("session summary", () => {
  it("skips an 8,192-token context", async () => {
    const chat = vi.fn(async (_input: ChatInput) => result("unused"));
    await expect(
      summarizeSession({ chat } as Pick<InferenceService, "chat">, {
        messages: messages(4),
        modelId: "model",
        contextTokens: 8_192,
        library,
      }),
    ).resolves.toBeUndefined();
    expect(chat).not.toHaveBeenCalled();
  });

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
    expect(chat.mock.calls[0]?.[0].messages[0]).toEqual(
      expect.objectContaining({
        role: "system",
        text: expect.stringContaining("Current host date and time:"),
      }),
    );
  });

  it("stores the required anchor progression for the measured continuity-session shape", async () => {
    const items = continuitySessionMessages();
    const first = items.at(0);
    if (first === undefined) throw new Error("missing_continuity_message");
    let previous: AgentSessionSummary | undefined;
    const save = vi.fn((input: SummarySaveInput) => {
      previous = savedSummary(input);
      return previous;
    });
    const chat = vi.fn(async (_input: ChatInput) => result("## Objective\n- Continue"));
    for (const count of [2, 4, 6, 8, 10, 12, 14]) {
      await refreshSessionSummary({ chat } as Pick<InferenceService, "chat">, {
        sessionId: first.sessionId,
        runId: "00000000-0000-4000-8000-000000000301" as never,
        contextTokens: 65_536,
        loadMessages: () => items.slice(0, count),
        modelId: "model",
        library,
        store: { load: () => previous, save },
      });
    }

    expect(chat).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls.map(([input]) => input.coveredMessageCount)).toEqual([4, 8, 12]);
  });

  it("records an invalid compaction for an empty summary response", async () => {
    const trace = traceRecorder();
    const save = vi.fn();

    await expect(
      refreshSessionSummary(
        { chat: vi.fn(async (_input: ChatInput) => result(" \n\t ")) } as Pick<
          InferenceService,
          "chat"
        >,
        refreshInput(trace, save),
      ),
    ).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
    expect(trace.captureResponse).toHaveBeenCalledWith("turn-1", { text: "" }, 16_384);
    expect(trace.recordOutcome).toHaveBeenCalledWith("turn-1", "invalid_response");
  });

  it.each(["internal", "worker_crash", "malformed_worker_message"] as const)(
    "retries one %s failure with a new identity and trace turn before saving",
    async (code) => {
      const trace = traceRecorder();
      const save: SummarySave = vi.fn(savedSummary);
      const identities: unknown[] = [];
      let calls = 0;
      const chat = vi.fn(
        async (
          _input: ChatInput,
          _signal?: AbortSignal,
          _streams?: unknown,
          identity?: unknown,
        ) => {
          identities.push(identity);
          calls += 1;
          if (calls === 1) throw new InferenceFailure(code, code);
          return result("## Objective\n- Recovered");
        },
      );

      const summary = await refreshSessionSummary(
        { chat } as Pick<InferenceService, "chat">,
        refreshInput(trace, save),
      );

      expect(summary?.text).toContain("Recovered");
      expect(save).toHaveBeenCalledOnce();
      expect(identities[0]).not.toEqual(identities[1]);
      expect(trace.begin).toHaveBeenCalledTimes(2);
      expect(trace.recordOutcome).toHaveBeenNthCalledWith(1, "turn-1", "inference_failed");
      expect(trace.recordOutcome).toHaveBeenNthCalledWith(2, "turn-2", "accepted_compaction");
    },
  );

  it("keeps a completed run nonfatal after two retryable summary failures", async () => {
    const trace = traceRecorder();
    const save = vi.fn();
    const chat = vi.fn(async () => {
      throw new InferenceFailure("worker_crash", "worker_crash");
    });

    await expect(
      refreshSessionSummary({ chat } as Pick<InferenceService, "chat">, refreshInput(trace, save)),
    ).resolves.toBeUndefined();

    expect(chat).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
    expect(trace.begin).toHaveBeenCalledTimes(2);
    expect(trace.recordOutcome).toHaveBeenNthCalledWith(1, "turn-1", "inference_failed");
    expect(trace.recordOutcome).toHaveBeenNthCalledWith(2, "turn-2", "inference_failed");
  });

  it.each(["cancelled", "timeout", "out_of_memory", "unsupported", "invalid_request"] as const)(
    "does not retry a %s summary failure",
    async (code) => {
      const trace = traceRecorder();
      const chat = vi.fn(async () => {
        throw new InferenceFailure(code, code);
      });

      await expect(
        refreshSessionSummary({ chat } as Pick<InferenceService, "chat">, refreshInput(trace)),
      ).resolves.toBeUndefined();

      expect(chat).toHaveBeenCalledOnce();
      expect(trace.begin).toHaveBeenCalledOnce();
    },
  );

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

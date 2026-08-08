import type { ConversationMessage } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { assembleHistory } from "./history.js";
import { defaultPromptLibrary } from "./prompt-library.js";
import {
  fittedSummaryMessages,
  summarizableMessages,
  summarizeSession,
} from "./session-summary.js";

function message(id: string, role: "user" | "assistant", content: string): ConversationMessage {
  return {
    id,
    sessionId: "8f1d0f6e-1f0e-4a5e-9f0a-0b1c2d3e4f50",
    role,
    content,
    runId: null,
    createdAt: "2026-08-08T10:00:00.000Z",
  } as ConversationMessage;
}

const conversation = [
  message("m1", "user", "Analyze the invoice folder."),
  message("m2", "assistant", "Reviewed 12 workbooks."),
  message("m3", "user", "Now filter for priority rows."),
  message("m4", "assistant", "Filtered and saved a workbook."),
];

function inference(value: unknown, calls: string[] = []) {
  return {
    async generate(input: { prompt: string }) {
      calls.push(input.prompt);
      return {
        protocolVersion: 1 as const,
        requestId: "summary-test",
        status: "ok" as const,
        operation: "generate" as const,
        value,
        memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
        performance: {
          promptTokens: 1,
          outputTokens: 1,
          promptDurationMs: 1,
          generationDurationMs: 1,
          totalDurationMs: 2,
        },
      };
    },
  };
}

describe("anchored session summary", () => {
  it("summarizes a session once it exceeds the verbatim threshold", async () => {
    const calls: string[] = [];
    const result = await summarizeSession(
      inference({ summary: ["## Objective", "- Filter invoice rows."] }, calls),
      {
        messages: conversation,
        modelId: "gemma-4-12b-it-qat-q4_0",
        contextTokens: 65_536,
        library: defaultPromptLibrary(),
      },
    );
    expect(result?.text).toContain("## Objective");
    expect(result?.coveredMessageId).toBe("m4");
    expect(result?.coveredMessageCount).toBe(4);
    expect(calls[0]).toContain("Create a new anchored summary");
  });

  it("merges into the previous anchor instead of re-deriving from scratch", async () => {
    const calls: string[] = [];
    await summarizeSession(inference({ summary: ["## Objective", "- Continue."] }, calls), {
      messages: [
        ...conversation,
        message("m5", "user", "Also total them."),
        message("m6", "assistant", "Totalled."),
        message("m7", "user", "Then export a workbook."),
        message("m8", "assistant", "Exported."),
      ],
      modelId: "gemma-4-12b-it-qat-q4_0",
      contextTokens: 65_536,
      library: defaultPromptLibrary(),
      previous: {
        sessionId: "8f1d0f6e-1f0e-4a5e-9f0a-0b1c2d3e4f50",
        runId: "3f1d0f6e-1f0e-4a5e-9f0a-0b1c2d3e4f51",
        text: "## Objective\n- Analyze invoices.",
        coveredMessageId: "m4",
        coveredMessageCount: 4,
        createdAt: "2026-08-08T10:00:00.000Z",
      } as never,
    });
    expect(calls[0]).toContain("<previous-summary>");
    expect(calls[0]).toContain("- Analyze invoices.");
    expect(calls[0]).toContain("Also total them.");
    expect(calls[0]).not.toContain("Analyze the invoice folder.");
  });
});

describe("anchored session summary guardrails", () => {
  it("skips summarization below the certified context floor", async () => {
    const calls: string[] = [];
    const result = await summarizeSession(inference({ summary: ["x"] }, calls), {
      messages: conversation,
      modelId: "gemma-4-12b-it-qat-q4_0",
      contextTokens: 8_192,
      library: defaultPromptLibrary(),
    });
    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("returns undefined when the model fails or returns nothing usable", async () => {
    const failing = {
      async generate() {
        throw new Error("inference_failed");
      },
    };
    const base = {
      messages: conversation,
      modelId: "gemma-4-12b-it-qat-q4_0",
      contextTokens: 65_536,
      library: defaultPromptLibrary(),
    };
    await expect(summarizeSession(failing, base)).resolves.toBeUndefined();
    await expect(summarizeSession(inference({ summary: [] }), base)).resolves.toBeUndefined();
    await expect(summarizeSession(inference({ wrong: true }), base)).resolves.toBeUndefined();
  });

  it("covers only messages the anchor has not already summarized", () => {
    expect(summarizableMessages(conversation, undefined)).toHaveLength(4);
    expect(
      summarizableMessages(conversation, {
        coveredMessageId: "m2",
      } as never),
    ).toHaveLength(2);
  });
});

describe("anchored session summary backlog", () => {
  it("advances through an oversized backlog in allocation-bounded prefixes", async () => {
    const messages = Array.from({ length: 120 }, (_, index) =>
      message(
        `backlog-${index}`,
        index % 2 === 0 ? "user" : "assistant",
        `turn-${index}-${"x".repeat(3_000)}`,
      ),
    );
    const input = {
      messages,
      modelId: "gemma-4-12b-it-qat-q4_0",
      contextTokens: 16_384,
      library: defaultPromptLibrary(),
    };
    const selected = fittedSummaryMessages(input, messages);
    expect(selected.length).toBeGreaterThanOrEqual(4);
    expect(selected.length).toBeLessThan(messages.length);

    const calls: string[] = [];
    const result = await summarizeSession(
      inference({ summary: ["## Work State", "- Backlog advanced."] }, calls),
      input,
    );
    expect(result?.coveredMessageCount).toBe(selected.length);
    expect(result?.coveredMessageId).toBe(selected.at(-1)?.id);
    expect(calls[0]).not.toContain("turn-119-");

    const remaining = summarizableMessages(messages, {
      coveredMessageId: result?.coveredMessageId,
    } as never);
    expect(remaining[0]?.id).toBe(`backlog-${selected.length}`);
  });
});

describe("anchored session summary recovery", () => {
  it("retries one missing structured call with a fresh request", async () => {
    const prompts: string[] = [];
    const identities: string[] = [];
    const successful = inference({ summary: ["## Objective", "- Continue offline."] });
    let attempts = 0;
    const recovering = {
      async generate(
        input: { prompt: string },
        _signal?: AbortSignal,
        _thinking?: unknown,
        identity?: unknown,
      ) {
        prompts.push(input.prompt);
        identities.push(JSON.stringify(identity));
        attempts += 1;
        if (attempts === 1) throw new Error("structured_tool_call_required");
        return await successful.generate(input);
      },
    };
    const result = await summarizeSession(recovering, {
      messages: conversation,
      modelId: "gemma-4-12b-it-qat-q4_0",
      contextTokens: 65_536,
      library: defaultPromptLibrary(),
    });
    expect(result?.text).toContain("Continue offline.");
    expect(prompts).toHaveLength(2);
    expect(new Set(identities).size).toBe(2);
    expect(prompts[1]).toContain("returned prose instead of the required structured summary call");
  });
});

describe("history anchored fallback", () => {
  // Many long older turns exhaust the excerpt ladder while two short newest turns
  // still fit the protected recent-conversation budget.
  function longSession(): ConversationMessage[] {
    return [
      ...Array.from({ length: 60 }, (_, index) =>
        message(`old-${index}`, index % 2 === 0 ? "user" : "assistant", "x".repeat(600)),
      ),
      message("recent-user-first", "user", "next"),
      message("recent-assistant-first", "assistant", "ok"),
      message("recent-user", "user", "then"),
      message("recent-assistant", "assistant", "ok"),
    ];
  }

  it("uses the anchored summary instead of a bare omitted-message count", () => {
    const assembled = assembleHistory(
      { messages: longSession(), runs: [], summary: "## Objective\n- Ship the Windows gate." },
      200,
    );
    expect(assembled).toContain("Anchored summary of earlier turns");
    expect(assembled).toContain("- Ship the Windows gate.");
    expect(assembled).not.toContain("older messages remain in durable conversation history");
  });

  it("keeps the deterministic marker when no anchored summary exists", () => {
    const assembled = assembleHistory({ messages: longSession(), runs: [] }, 200);
    expect(assembled).toContain("older messages remain in durable conversation history");
  });
});

import type { AgentExecutionResult, ConversationMessage } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { generationInput } from "./prompt.js";
import { generationTokenReserve } from "./prompt-budget.js";

const CONTEXT_TIERS = [8_192, 16_384, 65_536, 131_072] as const;

function progress(executions: AgentExecutionResult[] = []) {
  return {
    executions,
    inference: {
      promptTokens: 0,
      outputTokens: 0,
      promptDurationMs: 0,
      generationDurationMs: 0,
      totalDurationMs: 0,
    },
    rejectedDuplicates: 0,
  };
}

function execution(
  source: string,
  stdout: string,
  exitCode = 0,
  termination: AgentExecutionResult["termination"] = exitCode === 0 ? "completed" : "crash",
): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/0001.py",
    source,
    command: null,
    exitCode,
    stdout,
    stderr: exitCode === 0 ? "" : "SyntaxError",
    durationMs: 1,
    termination,
    artifacts: [],
  };
}

function message(id: string, role: "user" | "assistant", content: string): ConversationMessage {
  return {
    id,
    sessionId: "dynamic-context-session",
    role,
    content,
    runId: null,
    createdAt: "2026-08-08T10:00:00.000Z",
  } as ConversationMessage;
}

function expectRequestFits(contextTokens: number, request: ReturnType<typeof generationInput>) {
  const reserve = generationTokenReserve(contextTokens, request.maxTokens);
  expect(Math.ceil(JSON.stringify(request).length / 4)).toBeLessThanOrEqual(
    contextTokens - reserve,
  );
}

describe("hardware-derived prompt compaction", () => {
  it("fits a cold mixed-office request at the certified minimum context", () => {
    const request = generationInput(
      {
        task: [
          "Review the complete selected business folder, including invoice workbooks, Word meeting notes, and the policy PDF.",
          "Find invoice rows whose note contains Priority review and total their amount values; also count Decision record paragraphs in the meeting notes and Policy section pages in the policy PDF.",
          "Create a polished Word management report named management-report.docx in the private workspace.",
          "The report must visibly label the four results as MATCHING_INVOICES, INVOICE_TOTAL, MEETING_NOTES, and POLICY_PAGES so another local process can verify them.",
        ].join(" "),
        modelId: "test",
      },
      progress(),
      false,
      { contextTokens: 8_192 },
    );
    expect(request.prompt).toContain("## Active skill: docx-documents");
    expect(request.prompt).toContain("## Active skill: pdf-documents");
    expect(request.prompt).toContain("## Active skill: xlsx-workbooks");
    expectRequestFits(8_192, request);
  });

  it("compacts the same output only where the allocated prompt budget requires it", () => {
    const completed = execution("print('done')", "x".repeat(20_000));
    for (const contextTokens of CONTEXT_TIERS) {
      const request = generationInput(
        { task: "Summarize the completed inspection.", modelId: "test" },
        progress([completed]),
        false,
        { contextTokens },
      );
      expect(request.prompt.includes("# Compacted task state")).toBe(contextTokens <= 16_384);
      expectRequestFits(contextTokens, request);
    }
  });
});

describe("hardware-derived source compaction", () => {
  it("compacts successful maximum-size source while preserving failed repair source", () => {
    const source = "x".repeat(128_000);
    for (const contextTokens of CONTEXT_TIERS) {
      const request = generationInput(
        { task: "Continue after the completed script.", modelId: "test" },
        progress([execution(source, "done")]),
        false,
        { contextTokens },
      );
      expect(request.prompt).toContain("# Compacted task state");
      expect(request.prompt).toContain('"sourceCharacters":128000');
      expect(request.prompt).not.toContain(source);
      expectRequestFits(contextTokens, request);
    }
    const limited = generationInput(
      { task: "Continue from the bounded output.", modelId: "test" },
      progress([execution(source, "useful bounded output", 0, "resource_limit")]),
      false,
      { contextTokens: 8_192 },
    );
    expect(limited.prompt).not.toContain(source);
    expectRequestFits(8_192, limited);
    expect(() =>
      generationInput(
        { task: "Repair the failed script.", modelId: "test" },
        progress([execution(source, "", 1)]),
        false,
        { contextTokens: 8_192 },
      ),
    ).toThrow("agent_context_exhausted");
  });
});

describe("hardware-derived conversation compaction", () => {
  it("uses an anchor only when verbatim older chat exceeds the allocated budget", () => {
    const oldDecision = `old decision ${"x".repeat(30_000)}`;
    const history = {
      messages: [
        message("m1", "user", oldDecision),
        message("m2", "assistant", "Recorded."),
        message("m3", "user", "First recent turn."),
        message("m4", "assistant", "Recorded."),
        message("m5", "user", "Second recent turn."),
        message("m6", "assistant", "Recorded."),
      ],
      runs: [],
      summary: "## Objective\n- Preserve the old decision.",
    };
    for (const contextTokens of CONTEXT_TIERS) {
      const request = generationInput(
        { task: "Continue.", modelId: "test", history },
        progress(),
        false,
        { contextTokens },
      );
      const compacted = contextTokens <= 16_384;
      expect(request.prompt.includes("Anchored summary of earlier turns")).toBe(compacted);
      expect(request.prompt.includes(oldDecision)).toBe(!compacted);
      expectRequestFits(contextTokens, request);
    }
  });
});

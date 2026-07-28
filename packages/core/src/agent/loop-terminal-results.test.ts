import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { type AgentExecutor, AgentLoop } from "./loop.js";
import { verifiedExactOutput } from "./output-contract.js";

const performance = {
  promptTokens: 10,
  outputTokens: 5,
  promptDurationMs: 100,
  generationDurationMs: 500,
  totalDurationMs: 600,
};

function inference(decision: AgentDecision): Pick<InferenceService, "generate"> {
  return {
    async generate() {
      return {
        protocolVersion: 1,
        requestId: "test",
        status: "ok",
        operation: "generate",
        value: decision,
        memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
        performance,
      };
    },
  };
}

describe("AgentLoop explicit terminal results", () => {
  it("returns an explicitly required terminal token from a failed execution", async () => {
    const source = "print('INVALID_DOCUMENT_STOP=1'); raise SystemExit(1)";
    const failed: AgentExecutionResult = {
      language: "python",
      path: "steps/0001.py",
      source,
      command: null,
      exitCode: 1,
      stdout: "INVALID_DOCUMENT_STOP=1\n",
      stderr: "Document parse failed.\n",
      durationMs: 10,
      termination: "crash",
      artifacts: [],
    };
    const calls: string[] = [];
    const executor: AgentExecutor = {
      async execute(input) {
        calls.push(input.language === "shell" ? input.command : input.source);
        return failed;
      },
    };
    const result = await new AgentLoop(
      inference({ action: "execute", language: "python", source, summary: "Inspect" }),
      executor,
    ).run({
      task: "When parsing fails, stop immediately and print INVALID_DOCUMENT_STOP=1.",
      modelId: "test-model",
    });

    expect(result.response).toBe("INVALID_DOCUMENT_STOP=1");
    expect(calls).toEqual([source]);
  });
});

describe("explicit terminal output contract", () => {
  const execution: AgentExecutionResult = {
    language: "python",
    path: "steps/0001.py",
    source: "print('STOP=1')",
    command: null,
    exitCode: 1,
    stdout: "STOP=1\n",
    stderr: "failed\n",
    durationMs: 1,
    termination: "crash",
    artifacts: [],
  };

  it("rejects incidental assignments, extra stdout, and incomplete placeholder output", () => {
    expect(verifiedExactOutput([execution], "Use LIMIT=1 and inspect the input.")).toBeUndefined();
    expect(
      verifiedExactOutput([{ ...execution, stdout: "diagnostic\nSTOP=1\n" }], "Print STOP=1."),
    ).toBeUndefined();
    expect(verifiedExactOutput([execution], "Print STOP=1 and RESULT=<value>.")).toBeUndefined();
  });
});

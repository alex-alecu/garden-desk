import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";

const performance = {
  promptTokens: 1,
  outputTokens: 1,
  promptDurationMs: 1,
  generationDurationMs: 1,
  totalDurationMs: 2,
};

describe("AgentLoop structured recovery", () => {
  it("retries one missing Gemma function call with an exact stronger prompt", async () => {
    const prompts: string[] = [];
    let attempt = 0;
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) throw new Error("structured_tool_call_required");
        return {
          protocolVersion: 1,
          requestId: "recovery-test",
          status: "ok",
          operation: "generate",
          value: { action: "respond", response: "Recovered." },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
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
    const result = await new AgentLoop(model, {
      async execute() {
        throw new Error("unexpected_execution");
      },
    }).run({ task: "Reply", modelId: "gemma-4-test" });

    expect(result.response).toBe("Recovered.");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Your previous attempt did not call a function.");
    expect(prompts[1]).toMatch(/Call exactly one available function with your answer\.$/u);
  });
});

function completedSource(path: string, source: string, stdout: string): AgentExecutionResult {
  return {
    language: "python",
    path,
    source,
    command: null,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function expectGenerationRecovery(
  requests: Parameters<InferenceService["generate"]>[0][],
  events: string[],
): void {
  expect(requests.every((request) => request.maxTokens === 32_768)).toBe(true);
  expect(requests[1]?.prompt).toContain("reached the 32,768-token generation limit");
  expect(requests[1]?.prompt).toContain("create or patch one bounded part");
  expect(JSON.stringify(requests[1]?.jsonSchema)).toContain('"maxItems":64');
  expect(events).toContain(
    "The local model reached its 32K generation limit. Continuing with a smaller workspace edit.",
  );
}

describe("AgentLoop generation-limit recovery", () => {
  it("continues a long program as separate persistent workspace edits", async () => {
    const create = "from pathlib import Path\nPath('program.py').write_text('part one\\n')";
    const append =
      "from pathlib import Path\np=Path('program.py')\np.write_text(p.read_text()+'part two\\n')";
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: create, summary: "Create first part" },
      { action: "execute", language: "python", source: append, summary: "Append second part" },
      { action: "respond", response: "Completed in two edits." },
    ];
    const requests: Parameters<InferenceService["generate"]>[0][] = [];
    const events: string[] = [];
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        requests.push(input);
        if (requests.length === 1) throw new Error("generation_token_limit");
        return {
          protocolVersion: 1,
          requestId: "generation-limit-test",
          status: "ok",
          operation: "generate",
          value: decisions.shift(),
          memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
          performance,
        };
      },
    };
    const results = [
      completedSource("steps/0001.py", create, "checkpoint 1\n"),
      completedSource("steps/0002.py", append, "checkpoint 2\n"),
    ];
    const result = await new AgentLoop(model, {
      async execute() {
        const execution = results.shift();
        if (execution === undefined) throw new Error("unexpected_execution");
        return execution;
      },
    }).run({
      task: "Build a long program",
      modelId: "gemma-4-test",
      onEvent: (_type, summary) => events.push(summary),
    });

    expect(result.response).toBe("Completed in two edits.");
    expect(result.executions.map((execution) => execution.source)).toEqual([create, append]);
    expectGenerationRecovery(requests, events);
  });
});

describe("AgentLoop repeated generation limit", () => {
  it("returns a specific failure after the bounded recovery also reaches the limit", async () => {
    const loop = new AgentLoop(
      {
        async generate() {
          throw new Error("generation_token_limit");
        },
      },
      {
        async execute() {
          throw new Error("unexpected_execution");
        },
      },
    );

    await expect(
      loop.run({ task: "Build a long program", modelId: "gemma-4-test" }),
    ).rejects.toThrow("agent_generation_limit");
  });
});

import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";
import {
  boundedObservationStream,
  OBSERVATION_STREAM_CHARACTERS,
  observationStreamCharacters,
  observations,
} from "./prompt-observations.js";

function execution(stdout: string) {
  return {
    language: "python" as const,
    path: "steps/1.py",
    source: "print('x')",
    command: null,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    termination: "completed" as const,
    artifacts: [],
  };
}

describe("bounded observation streams", () => {
  it("keeps output at the limit complete", () => {
    const text = "x".repeat(OBSERVATION_STREAM_CHARACTERS);

    expect(boundedObservationStream(text)).toBe(text);
  });

  it("keeps the head and the tail of oversized output", () => {
    const stdout = `FIRST PAGE${"x".repeat(200_000)}LAST PAGE`;

    const bounded = boundedObservationStream(stdout);

    expect(bounded).toContain("FIRST PAGE");
    expect(bounded).toContain("LAST PAGE");
    expect(bounded.length).toBeLessThanOrEqual(OBSERVATION_STREAM_CHARACTERS);
  });

  it("states that the excerpt is incomplete and names the workspace remedy", () => {
    const bounded = boundedObservationStream("y".repeat(120_000));

    expect(bounded).toContain("characters omitted from the middle of this execution field");
    expect(bounded).toContain("This field is an excerpt, not the complete value.");
    expect(bounded).toContain("Successful source remains at its assigned /workspace path.");
    expect(bounded).toContain("write it to a /workspace file");
  });

  it("shrinks the excerpt for a small prompt budget and never exceeds the ceiling", () => {
    expect(observationStreamCharacters(131_072)).toBe(OBSERVATION_STREAM_CHARACTERS);
    expect(observationStreamCharacters(4_096)).toBe(8_192);
    expect(observationStreamCharacters(0)).toBe(2_048);
  });

  it("bounds each observed stream without dropping execution evidence", () => {
    const [observed] = observations([execution("z".repeat(500_000))]);

    expect(observed).toMatchObject({
      step: 1,
      language: "python",
      path: "steps/1.py",
      source: "print('x')",
      exitCode: 0,
      termination: "completed",
    });
    expect(observed?.stdout.length).toBeLessThanOrEqual(OBSERVATION_STREAM_CHARACTERS);
  });

  it("shares one bound across every observed stream", () => {
    const observed = observations(
      [execution("a".repeat(500_000)), execution("b".repeat(500_000))],
      8_192,
    );

    expect(observed.reduce((length, item) => length + item.stdout.length, 0)).toBeLessThanOrEqual(
      8_192,
    );
    expect(observed.every((item) => item.stdout.includes("characters omitted"))).toBe(true);
  });
});

describe("oversized stdout in the decision prompt", () => {
  it("elides the middle instead of exhausting the context", async () => {
    const stdout = `CONTRACT PAGE 1${"x".repeat(200_000)}SIGNED PAGE 25`;
    const extraction: AgentExecutionResult = { ...execution(stdout), durationMs: 10 };
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: "print('x')", summary: "Extract" },
      { action: "respond", response: "The contract runs to page 25." },
    ];
    const prompts: string[] = [];
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        prompts.push(input.prompt);
        const value = decisions.shift();
        if (value === undefined) throw new Error("Missing fake agent decision.");
        return {
          protocolVersion: 1,
          requestId: "test",
          status: "ok",
          operation: "generate",
          value,
          memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
          performance: {
            promptTokens: 10,
            outputTokens: 5,
            promptDurationMs: 100,
            generationDurationMs: 500,
            totalDurationMs: 600,
          },
        };
      },
    };

    const result = await new AgentLoop(model, {
      async execute() {
        return extraction;
      },
    }).run({ task: "Give me a summary", modelId: "test-model" });

    expect(result.response).toBe("The contract runs to page 25.");
    expect(prompts[1]).toContain("CONTRACT PAGE 1");
    expect(prompts[1]).toContain("SIGNED PAGE 25");
    expect(prompts[1]).toContain("characters omitted from the middle of this execution field");
    expect(prompts[1]).toContain("# Compacted task state");
    expect(prompts[1]).toContain("Task ledger:");
    expect(prompts[1]).toContain("Evidence ledger:");
    expect(prompts[1]?.length).toBeLessThan(stdout.length);
    expect(result.executions[0]?.stdout).toBe(stdout);
  });
});

describe("multiple oversized stdout streams", () => {
  it("keeps multiple oversized executions inside the minimum context", async () => {
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: "print('1')", summary: "First" },
      { action: "execute", language: "python", source: "print('2')", summary: "Second" },
      { action: "respond", response: "Complete." },
    ];
    const model: Pick<InferenceService, "generate"> = {
      async generate() {
        const value = decisions.shift();
        if (value === undefined) throw new Error("Missing fake agent decision.");
        return {
          protocolVersion: 1,
          requestId: "test",
          status: "ok",
          operation: "generate",
          value,
          memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
          performance: {
            promptTokens: 10,
            outputTokens: 5,
            promptDurationMs: 100,
            generationDurationMs: 500,
            totalDurationMs: 600,
          },
        };
      },
    };

    const result = await new AgentLoop(model, {
      async execute() {
        return { ...execution("x".repeat(200_000)), durationMs: 10 };
      },
    }).run({ task: "Run two inspections", modelId: "test-model" });

    expect(result.response).toBe("Complete.");
    expect(result.executions).toHaveLength(2);
  });
});

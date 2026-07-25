import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { type AgentExecutor, AgentLoop } from "./loop.js";

const performance = {
  promptTokens: 10,
  outputTokens: 5,
  promptDurationMs: 100,
  generationDurationMs: 500,
  totalDurationMs: 600,
};

function inference(decisions: AgentDecision[]): Pick<InferenceService, "generate"> {
  return {
    async generate() {
      const value = decisions.shift();
      if (value === undefined) throw new Error("Missing fake agent decision.");
      return {
        protocolVersion: 1,
        requestId: "test",
        status: "ok",
        operation: "generate",
        value,
        memory: {
          cpuRamBytes: 1,
          gpuVramBytes: 1,
          budgetBytes: 1,
          detectedGpuVramBytes: 1,
        },
        performance,
      };
    },
  };
}

function capturingInference(
  decisions: AgentDecision[],
  prompts: string[],
  schemas: Array<Record<string, unknown>> = [],
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      prompts.push(input.prompt);
      schemas.push(input.jsonSchema);
      return await inference(decisions).generate(input);
    },
  };
}

function executor(results: AgentExecutionResult[], calls: string[]): AgentExecutor {
  return {
    async execute(input) {
      calls.push(input.language === "shell" ? input.command : input.source);
      const result = results.shift();
      if (result === undefined) throw new Error("Missing fake execution result.");
      return result;
    },
  };
}

const completed: AgentExecutionResult = {
  language: "python",
  path: "steps/0001.py",
  source: "print(2 + 2)",
  command: null,
  exitCode: 0,
  stdout: "4\n",
  stderr: "",
  durationMs: 10,
  termination: "completed",
  artifacts: [],
};

describe("AgentLoop schema", () => {
  it("uses object alternatives supported by the inference grammar", async () => {
    let schema: Record<string, unknown> | undefined;
    let contextSize: number | "auto" | undefined;
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        schema = input.jsonSchema;
        contextSize = input.contextSize;
        return {
          protocolVersion: 1,
          requestId: "test",
          status: "ok",
          operation: "generate",
          value: { action: "respond", response: "Done." },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance,
        };
      },
    };
    const loop = new AgentLoop(model, executor([], []));

    await loop.run({ task: "Reply", modelId: "test-model" });

    expect(schema).not.toHaveProperty("type");
    expect(schema?.oneOf).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "object" })]),
    );
    expect(schema?.oneOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            response: expect.objectContaining({
              type: "array",
              items: expect.objectContaining({ maxLength: 512 }),
            }),
          }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({
            source: expect.objectContaining({
              type: "array",
              items: expect.objectContaining({ maxLength: 512 }),
            }),
          }),
        }),
      ]),
    );
    expect(contextSize).toBe("auto");
  });
});

describe("AgentLoop thinking", () => {
  it("forwards transient thinking without adding it to the result", async () => {
    const updates: Array<string | null> = [];
    const model: Pick<InferenceService, "generate"> = {
      async generate(_input, _signal, onThinkingDelta) {
        onThinkingDelta?.("First ");
        onThinkingDelta?.("thought.");
        return {
          protocolVersion: 1,
          requestId: "test",
          status: "ok",
          operation: "generate",
          value: { action: "respond", response: "Done." },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance,
        };
      },
    };

    const result = await new AgentLoop(model, executor([], [])).run({
      task: "Reply",
      modelId: "test-model",
      onThinking: (text) => updates.push(text),
    });

    expect(updates).toEqual([null, "First ", "First thought.", null]);
    expect(JSON.stringify(result)).not.toContain("thought");
  });
});

describe("AgentLoop source", () => {
  it("preserves generated multiline source before execution", async () => {
    const calls: string[] = [];
    const model: Pick<InferenceService, "generate"> = {
      async generate() {
        return {
          protocolVersion: 1,
          requestId: "test",
          status: "ok",
          operation: "generate",
          value: {
            action: "execute",
            language: "python",
            source: ["value = 2 + 2", "print(value)"],
            summary: "Calculate",
          },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance,
        };
      },
    };
    const loop = new AgentLoop(model, executor([{ ...completed }], calls));

    await expect(loop.run({ task: "Calculate", modelId: "test-model" })).rejects.toThrow(
      "Missing fake execution result.",
    );
    expect(calls[0]).toBe("value = 2 + 2\nprint(value)");
  });
});

describe("AgentLoop response", () => {
  it("joins generated response lines", async () => {
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        return {
          ...(await inference([{ action: "respond", response: "unused" }]).generate(input)),
          value: { action: "respond", response: ["Summary", "Total: 4"] },
        };
      },
    };

    const result = await new AgentLoop(model, executor([], [])).run({
      task: "Reply",
      modelId: "test-model",
    });

    expect(result.response).toBe("Summary\nTotal: 4");
  });
});

function expectObservationPrompts(prompts: string[]): void {
  expect(prompts[1]).toContain(`"source":"${completed.source ?? ""}"`);
  expect(prompts[1]).not.toContain("private-input.xlsx");
  expect(prompts[1]).toContain("Selected input count: 1.");
  expect(prompts[1]).toContain("Successful execution count: 1.");
  expect(prompts[1]).toContain("Never import pandas");
  expect(prompts[1]).toContain("never assume a flat folder");
  expect(prompts[1]).toContain("sheet.iter_rows(values_only=True)");
  expect(prompts[1]).toContain("path.suffix.lower()");
  expect(prompts[1]).toContain("print(path.name, sheet.title, row)");
  expect(prompts[1]).toContain("smallest repair");
  expect(prompts[1]).toContain(
    "Always return final responses as concise GitHub Flavored Markdown, including single-line answers",
  );
  expect(prompts[0]).toContain("Current required phase: inspect before calculating.");
  expect(prompts[1]).not.toContain("Current required phase: inspect before calculating.");
  expect(prompts[1]).toContain("Current required phase: calculate and verify");
}

describe("AgentLoop observations", () => {
  it("feeds bounded execution observations back to the model", async () => {
    const decisions: AgentDecision[] = [
      {
        action: "execute",
        language: "python",
        source: completed.source ?? "",
        summary: "Calculate",
      },
      { action: "respond", response: "The answer is 4." },
    ];
    const calls: string[] = [];
    const prompts: string[] = [];
    const loop = new AgentLoop(
      capturingInference(decisions, prompts),
      executor([{ ...completed }], calls),
    );

    const result = await loop.run({
      task: "Calculate two plus two",
      modelId: "test-model",
      inputNames: ["private-input.xlsx"],
    });

    expect(calls).toEqual([completed.source ?? ""]);
    expect(result).toEqual({
      response: "The answer is 4.",
      executions: [completed],
      inference: {
        promptTokens: 20,
        outputTokens: 10,
        promptDurationMs: 200,
        generationDurationMs: 1_000,
        totalDurationMs: 1_200,
      },
    });
    expectObservationPrompts(prompts);
  });
});

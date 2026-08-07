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
const completed: AgentExecutionResult = {
  language: "python",
  path: "steps/0001.py",
  source: "print('done')",
  command: null,
  exitCode: 0,
  stdout: "done\n",
  stderr: "",
  durationMs: 10,
  termination: "completed",
  artifacts: [],
};

function inference(
  decisions: AgentDecision[],
  schemas: Array<Record<string, unknown>> = [],
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      schemas.push(input.jsonSchema);
      const value = decisions.shift();
      if (value === undefined) throw new Error("Missing fake agent decision.");
      return {
        protocolVersion: 1,
        requestId: "test",
        status: "ok",
        operation: "generate",
        value,
        memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
        performance,
      };
    },
  };
}

function executor(results: AgentExecutionResult[]): AgentExecutor {
  return {
    async execute() {
      const result = results.shift();
      if (result === undefined) throw new Error("Missing fake execution result.");
      return result;
    },
  };
}

describe("AgentLoop planning events", () => {
  it("reports a revised first step after a rejected initial proposal", async () => {
    const events: string[] = [];
    await new AgentLoop(
      inference([
        { action: "execute", language: "shell", command: "python3", summary: "Start Python" },
        { action: "execute", language: "python", source: completed.source, summary: "Run source" },
        { action: "respond", response: "Done." },
      ]),
      executor([{ ...completed }]),
    ).run({
      task: "Complete the task.",
      modelId: "test-model",
      onEvent(type, summary) {
        if (type === "inference.started") events.push(summary);
      },
    });

    expect(events.slice(0, 2)).toEqual([
      "Loading the local model and planning the task.",
      "Revising the plan for step 1.",
    ]);
  });

  it("reports a revised plan after a rejected proposal", async () => {
    const first = "print('first')";
    const revised = "print('revised')";
    const events: string[] = [];
    const result = await new AgentLoop(
      inference([
        { action: "execute", language: "python", source: first, summary: "First" },
        { action: "execute", language: "python", source: first, summary: "Repeat" },
        { action: "execute", language: "python", source: revised, summary: "Revise" },
        { action: "respond", response: "Done." },
      ]),
      executor([
        { ...completed, source: first },
        { ...completed, source: revised },
      ]),
    ).run({
      task: "Complete the task.",
      modelId: "test-model",
      onEvent(type, summary) {
        if (type === "inference.started") events.push(summary);
      },
    });

    expect(result.response).toBe("Done.");
    expect(events).toEqual([
      "Loading the local model and planning the task.",
      "Planning step 2.",
      "Revising the plan for step 2.",
      "Planning step 3.",
    ]);
  });
});

describe("AgentLoop source recovery", () => {
  it("keeps shell recovery source-only until a source execution succeeds", async () => {
    const schemas: Array<Record<string, unknown>> = [];
    const validSource = "print('done')";
    const repeatedSource = Array.from({ length: 40 }, () => "import os").join("\n");
    const result = await new AgentLoop(
      inference(
        [
          { action: "execute", language: "shell", command: "python3", summary: "Start Python" },
          {
            action: "execute",
            language: "python",
            source: repeatedSource,
            summary: "Try source",
          },
          { action: "execute", language: "python", source: validSource, summary: "Run source" },
          { action: "respond", response: "Done." },
        ],
        schemas,
      ),
      executor([{ ...completed, source: validSource }]),
    ).run({ task: "Complete the task.", modelId: "test-model" });

    expect(result.response).toBe("Done.");
    expect(schemas[0]).toHaveProperty("oneOf");
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(schemas[2]).not.toHaveProperty("oneOf");
    expect(schemas[3]).toHaveProperty("oneOf");
  });
});

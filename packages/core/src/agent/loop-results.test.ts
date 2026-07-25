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
  source: "print(2 + 2)",
  command: null,
  exitCode: 0,
  stdout: "4\n",
  stderr: "",
  durationMs: 10,
  termination: "completed",
  artifacts: [],
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

describe("AgentLoop repairs", () => {
  it("returns failed and empty-output source for focused repair", async () => {
    const failed = { ...completed, exitCode: 1, stdout: "", stderr: "SyntaxError" };
    const empty = { ...completed, source: "print('')", stdout: "" };
    const prompts: string[] = [];
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "python", source: failed.source ?? "", summary: "Try" },
          { action: "execute", language: "python", source: empty.source, summary: "Retry" },
          { action: "respond", response: "Could not verify." },
        ],
        prompts,
      ),
      executor([failed, empty], []),
    );

    await loop.run({ task: "Inspect input", modelId: "test-model" });

    expect(prompts[1]).toContain(`"source":"${failed.source}"`);
    expect(prompts[1]).toContain(`"path":"${failed.path}"`);
    expect(prompts[2]).toContain(`"source":"${empty.source}"`);
  });
});

describe("AgentLoop verified results", () => {
  it("asks the model for a final XLSX response after verified execution", async () => {
    const inspection = { ...completed, source: "print('rows')", stdout: "rows\n" };
    const resultEvidence = {
      ...completed,
      source: "print('Total: 4')",
      stdout: "| Count | Total |\n| ---: | ---: |\n| 1 | 4 |\n",
    };
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "python", source: inspection.source, summary: "Inspect" },
          {
            action: "execute",
            language: "python",
            source: resultEvidence.source,
            summary: "Calculate",
          },
          {
            action: "respond",
            response: "| Count | Total |\n| ---: | ---: |\n| 1 | 4 |",
          },
        ],
        [],
        schemas,
      ),
      executor([inspection, resultEvidence], []),
    );

    const result = await loop.run({
      task: "Summarize the workbook",
      modelId: "test-model",
      inputNames: ["input.xlsx"],
    });

    expect(result.response).toBe("| Count | Total |\n| ---: | ---: |\n| 1 | 4 |");
    expect(schemas[0]).not.toHaveProperty("oneOf");
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(schemas[2]).toHaveProperty("oneOf");
    expect(schemas).toHaveLength(3);
  });
});

describe("AgentLoop selected-folder XLSX", () => {
  it("uses the XLSX workflow for a selected-folder task that names Excel", async () => {
    const inspection = { ...completed, source: "print('rows')", stdout: "rows\n" };
    const resultEvidence = {
      ...completed,
      source: "print('Match count:', 1)",
      stdout: "Match count: 1\n",
    };
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "python", source: inspection.source, summary: "Inspect" },
          {
            action: "execute",
            language: "python",
            source: resultEvidence.source,
            summary: "Calculate",
          },
          { action: "respond", response: "**Match count:** 1" },
        ],
        prompts,
        schemas,
      ),
      executor([inspection, resultEvidence], []),
    );

    const result = await loop.run({
      task: "Check all Excel files deep in this folder",
      modelId: "test-model",
    });

    expect(result.response).toBe("**Match count:** 1");
    expect(prompts[0]).toContain("Current required phase: inspect before calculating.");
    expect(prompts[1]).toContain("Current required phase: calculate and verify");
    expect(schemas[0]).not.toHaveProperty("oneOf");
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(schemas[2]).toHaveProperty("oneOf");
  });
});

describe("AgentLoop limits", () => {
  it("uses a response-only inference after six executable steps", async () => {
    const calls: string[] = [];
    const results = Array.from({ length: 6 }, (_, index) => ({
      ...completed,
      source: `print(${index})`,
    }));
    const schemas: Array<Record<string, unknown>> = [];
    let generation = 0;
    const loop = new AgentLoop(
      {
        async generate(input) {
          schemas.push(input.jsonSchema);
          generation += 1;
          return await inference([
            generation <= 6
              ? {
                  action: "execute",
                  language: "python",
                  source: `print(${generation - 1})`,
                  summary: "Continue",
                }
              : { action: "respond", response: "Execution limit reached." },
          ]).generate(input);
        },
      },
      executor(results, calls),
    );

    const result = await loop.run({ task: "Keep going", modelId: "test-model" });

    expect(calls).toHaveLength(6);
    expect(result.response).toBe("Execution limit reached.");
    expect(schemas[6]).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ action: { const: "respond" } }),
      }),
    );
    expect(schemas[6]).not.toHaveProperty("oneOf");
  });
});

describe("AgentLoop duplicate decisions", () => {
  it("does not execute a program again after it already succeeded", async () => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const nextCode = "print('next')";
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: completed.source ?? "", summary: "Step 1" },
      { action: "execute", language: "python", source: completed.source ?? "", summary: "Repeat" },
      { action: "execute", language: "python", source: nextCode, summary: "Step 2" },
      { action: "respond", response: "Done." },
    ];
    const second = { ...completed, source: nextCode, stdout: "next\n" };
    const loop = new AgentLoop(
      capturingInference(decisions, prompts),
      executor([{ ...completed }, second], calls),
    );

    const result = await loop.run({ task: "Complete two steps", modelId: "test-model" });

    expect(calls).toEqual([completed.source ?? "", nextCode]);
    expect(result.executions).toEqual([completed, second]);
    expect(prompts[2]).toContain("Rejected exact duplicate programs: 1.");
  });
});

describe("AgentLoop failed duplicate decisions", () => {
  it("does not spend another execution on an unchanged failed program", async () => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const failed = {
      ...completed,
      exitCode: 1,
      stderr: "SyntaxError",
      termination: "crash" as const,
    };
    const repaired = { ...completed, source: "print('repaired')" };
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "python", source: failed.source ?? "", summary: "Try" },
          {
            action: "execute",
            language: "python",
            source: failed.source ?? "",
            summary: "Repeat",
          },
          {
            action: "execute",
            language: "python",
            source: repaired.source ?? "",
            summary: "Repair",
          },
          { action: "respond", response: "Done." },
        ],
        prompts,
      ),
      executor([failed, repaired], calls),
    );

    const result = await loop.run({ task: "Inspect input", modelId: "test-model" });

    expect(calls).toEqual([failed.source, repaired.source]);
    expect(result.executions).toEqual([failed, repaired]);
    expect(prompts[2]).toContain("Rejected exact duplicate programs: 1.");
  });
});

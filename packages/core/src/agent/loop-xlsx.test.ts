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
  source: "print('')",
  command: null,
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 10,
  termination: "completed",
  artifacts: [],
};

function inference(
  decisions: AgentDecision[],
  prompts: string[],
  schemas: Array<Record<string, unknown>> = [],
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      prompts.push(input.prompt);
      schemas.push(input.jsonSchema);
      const value = decisions.shift();
      if (value === undefined) throw new Error("Missing fake agent decision.");
      return {
        protocolVersion: 1,
        requestId: "xlsx-test",
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

function execute(source: string, summary: string): AgentDecision {
  return { action: "execute", language: "python", source, summary };
}

describe("AgentLoop XLSX progress", () => {
  it("advances after an empty inspection and returns verified calculation stdout", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const calls: string[] = [];
    const inspection = "print('inspection')";
    const calculation = "print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')";
    const resultEvidence = {
      ...completed,
      source: calculation,
      stdout: "XLSX_MATCHES=2\nXLSX_TOTAL=2003\n",
    };
    const result = await new AgentLoop(
      inference(
        [execute(inspection, "Inspect"), execute(calculation, "Calculate")],
        prompts,
        schemas,
      ),
      executor([{ ...completed, source: inspection }, resultEvidence], calls),
    ).run({
      task: "Use Python to find VAULT_STRESS_TARGET in every .xlsx row.",
      modelId: "test-model",
    });

    expect(result.response).toBe(resultEvidence.stdout.trim());
    expect(calls).toEqual([inspection, calculation]);
    expect(prompts[0]).toContain("needle = 'search term'.casefold()");
    expect(prompts[0]).toContain("needle in str(value).casefold()");
    expect(prompts[0]).toContain("load_workbook(path, read_only=True, data_only=True)");
    expect(prompts[0]).toContain("workbook.close()");
    expect(prompts[0]).not.toContain("'search term' in str(value).lower()");
    expect(prompts[1]).toContain("Current required phase: calculate and verify");
    expect(prompts[1]).toContain("amount_index = next(");
    expect(prompts[1]).toContain("print('LABEL=', value, sep='')");
    expect(prompts[1]).toContain("Add other file formats as sibling branches");
    expect(schemas).toHaveLength(2);
    expect(schemas.every((schema) => !Object.hasOwn(schema, "oneOf"))).toBe(true);
  });
});

describe("AgentLoop XLSX inspection repair", () => {
  it("repairs a crashed inspection with streaming workbook guidance", async () => {
    const prompts: string[] = [];
    const failedSource = "print('failed')";
    const repairedSource = "print('inspection')";
    const calculation = "print('XLSX_MATCHES=2\\nXLSX_TOTAL=2003')";
    const result = await new AgentLoop(
      inference(
        [
          execute(failedSource, "Inspect"),
          execute(repairedSource, "Repair inspection"),
          execute(calculation, "Calculate"),
        ],
        prompts,
      ),
      executor(
        [
          {
            ...completed,
            source: failedSource,
            exitCode: 255,
            termination: "crash",
          },
          { ...completed, source: repairedSource },
          {
            ...completed,
            source: calculation,
            stdout: "XLSX_MATCHES=2\nXLSX_TOTAL=2003\n",
          },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file. Print XLSX_MATCHES=<count> and XLSX_TOTAL=<sum>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=2\nXLSX_TOTAL=2003");
    expect(prompts[1]).toContain("Current required phase: repair the failed XLSX inspection");
    expect(prompts[1]).toContain("execute different code now");
    expect(prompts[1]).toContain("read_only=True");
    expect(prompts[2]).toContain("Current required phase: calculate and verify");
  });
});

describe("AgentLoop XLSX result repair", () => {
  it("repairs a calculation that omits a required output label", async () => {
    const prompts: string[] = [];
    const calculation = "print('calculation')";
    const repair = "print('XLSX_MATCHES=2\\nWORD_PAGES=36')";
    const result = await new AgentLoop(
      inference(
        [
          execute("print('inspect')", "Inspect"),
          execute(calculation, "Calculate"),
          execute(repair, "Repair"),
        ],
        prompts,
      ),
      executor(
        [
          { ...completed, source: "print('inspect')" },
          { ...completed, source: calculation, stdout: "XLSX_MATCHES=2\n" },
          { ...completed, source: repair, stdout: "XLSX_MATCHES=2\nWORD_PAGES=36\n" },
        ],
        [],
      ),
    ).run({
      task: "Inspect every .xlsx file. Print XLSX_MATCHES=<count> and WORD_PAGES=<count>.",
      modelId: "test-model",
    });

    expect(result.response).toBe("XLSX_MATCHES=2\nWORD_PAGES=36");
    expect(prompts[2]).toContain("Current required phase: repair the calculation");
    expect(prompts[2]).toContain("Missing required output labels: WORD_PAGES.");
  });
});

describe("AgentLoop duplicate stall", () => {
  it("fails after the model repeats the same program twice", async () => {
    const prompts: string[] = [];
    const calls: string[] = [];
    const repeated = execute("print('same')", "Repeat");
    const loop = new AgentLoop(
      inference([repeated, repeated, repeated], prompts),
      executor([{ ...completed, source: "print('same')", stdout: "same\n" }], calls),
    );

    await expect(loop.run({ task: "Inspect input", modelId: "test-model" })).rejects.toThrow(
      "agent_stalled_duplicate",
    );
    expect(calls).toEqual(["print('same')"]);
    expect(prompts).toHaveLength(3);
    expect(prompts[2]).toContain("Rejected exact duplicate programs: 1.");
  });
});

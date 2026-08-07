import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { normalizeDeliverableFactRendering } from "./artifact-declarations.js";
import { AgentLoop } from "./loop.js";
import { parseDecision } from "./prompt.js";
import { hasUnbalancedSourceDelimiters } from "./source-delimiters.js";

const performance = {
  promptTokens: 1,
  outputTokens: 1,
  promptDurationMs: 1,
  generationDurationMs: 1,
  totalDurationMs: 2,
};

function completed(source: string): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/repair.py",
    source,
    command: null,
    exitCode: 0,
    stdout: "repaired\n",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function model(decisions: AgentDecision[]) {
  return {
    async generate() {
      return {
        protocolVersion: 1 as const,
        requestId: "malformed-recovery-test",
        status: "ok" as const,
        operation: "generate" as const,
        value: decisions.shift(),
        memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
        performance,
      };
    },
  };
}

describe("source response normalization", () => {
  it("normalizes a function-call suffix and bracket debris", () => {
    expect(
      parseDecision({
        action: "execute",
        language: "python",
        source: ["if __name__ == '__main__':", "    main()veg", "],"],
        summary: "Repair",
      }),
    ).toMatchObject({ action: "execute", source: "if __name__ == '__main__':\n    main()" });
  });

  it("expands block-shaped escaped newlines but preserves an ordinary string escape", () => {
    const block = parseDecision({
      action: "execute",
      language: "python",
      source: ["import os\\nprint('x')\\n"],
      summary: "Repair",
    });
    expect(block).toMatchObject({ action: "execute", source: "import os\nprint('x')" });
    const literal = parseDecision({
      action: "execute",
      language: "python",
      source: ['print("a\\nb")'],
      summary: "Print",
    });
    expect(literal).toMatchObject({ action: "execute", source: 'print("a\\nb")' });
  });

  it("preserves a bracket inside an expanded source block", () => {
    const decision = parseDecision({
      action: "execute",
      language: "python",
      source: ["values = [\\n    1,\\n]\\nprint(values)"],
      summary: "Run",
    });
    expect(decision).toMatchObject({
      action: "execute",
      source: "values = [\n    1,\n]\nprint(values)",
    });
  });

  it("drops only bracket debris without an unmatched opening bracket", () => {
    const decision = parseDecision({
      action: "execute",
      language: "python",
      source: ["print('done')", "],"],
      summary: "Run",
    });
    expect(decision).toMatchObject({ action: "execute", source: "print('done')" });
  });
});

describe("source path normalization", () => {
  it("omits an unsafe optional source path so Core can assign one", () => {
    const decision = parseDecision({
      action: "execute",
      language: "python",
      path: "find /source -type f",
      source: ["print('done')"],
      summary: "Inspect",
    });
    expect(decision).toMatchObject({ action: "execute", source: "print('done')" });
    expect(decision).toHaveProperty("path", undefined);
  });
});

describe("source delimiter validation", () => {
  it("ignores apostrophes and brackets inside Python comments", async () => {
    const source = "value = [1]\n# workbook doesn't need another ]\nprint(value)";
    const executed: string[] = [];
    await new AgentLoop(
      model([
        { action: "execute", language: "python", source, summary: "Run" },
        { action: "respond", response: "Done." },
      ]),
      {
        async execute(input) {
          executed.push(input.language === "shell" ? input.command : input.source);
          return completed(source);
        },
      },
    ).run({ task: "Inspect files.", modelId: "test-model" });
    expect(executed).toEqual([source]);
  });

  it("rejects an ordinary string broken by a line break but keeps multi-line forms", () => {
    expect(hasUnbalancedSourceDelimiters("process.stdout.write('node-start\n');\n")).toBe(true);
    expect(hasUnbalancedSourceDelimiters("print('oops\n")).toBe(true);
    expect(hasUnbalancedSourceDelimiters("const t = `line one\nline two`;\n")).toBe(false);
    expect(hasUnbalancedSourceDelimiters('text = """first\nsecond"""\n')).toBe(false);
    expect(hasUnbalancedSourceDelimiters("text = '''first\nsecond'''\n")).toBe(false);
    expect(hasUnbalancedSourceDelimiters("process.stdout.write('node-start\\n');\n")).toBe(false);
  });
});

describe("AgentLoop malformed source recovery", () => {
  it("rejects an unknown bare identifier before execution", async () => {
    const repaired = "print('x')";
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: `${repaired}\nshutil`, summary: "Bad" },
      { action: "execute", language: "python", source: repaired, summary: "Repair" },
      { action: "respond", response: "Done." },
    ];
    const executed: string[] = [];
    await new AgentLoop(model(decisions), {
      async execute(input) {
        executed.push(input.language === "shell" ? input.command : input.source);
        return completed(repaired);
      },
    }).run({ task: "Inspect files.", modelId: "test-model" });
    expect(executed).toEqual([repaired]);
  });
});

describe("AgentLoop repeated source recovery", () => {
  it("keeps a long valid program with repeated ordinary identifiers", async () => {
    const source = Array.from({ length: 30 }, (_, index) => `row_${index} = row + ${index}`).join(
      "\n",
    );
    const executed: string[] = [];
    await new AgentLoop(
      model([
        { action: "execute", language: "python", source, summary: "Process rows" },
        { action: "respond", response: "Done." },
      ]),
      {
        async execute(input) {
          executed.push(input.language === "shell" ? input.command : input.source);
          return completed(source);
        },
      },
    ).run({ task: "Process rows.", modelId: "test-model" });
    expect(executed).toEqual([source]);
  });
});

describe("AgentLoop repeated chunk recovery", () => {
  it("rejects an adjacent repeated source chunk", async () => {
    const bad = `print('x')\n${"part = []".repeat(8)}`;
    const repaired = "print('x')";
    const executed: string[] = [];
    await new AgentLoop(
      model([
        { action: "execute", language: "python", source: bad, summary: "Bad" },
        { action: "execute", language: "python", source: repaired, summary: "Repair" },
        { action: "respond", response: "Done." },
      ]),
      {
        async execute(input) {
          executed.push(input.language === "shell" ? input.command : input.source);
          return completed(repaired);
        },
      },
    ).run({ task: "Process rows.", modelId: "test-model" });
    expect(executed).toEqual([repaired]);
  });

  it("requires a flat top-level strategy after invalid source", async () => {
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: "print('x')\nshutil", summary: "Bad" },
      { action: "execute", language: "python", source: "print('x')", summary: "Repair" },
      { action: "respond", response: "Done." },
    ];
    const prompts: string[] = [];
    await new AgentLoop(
      {
        async generate(input) {
          prompts.push(input.prompt);
          return {
            protocolVersion: 1,
            requestId: "flat-recovery-test",
            status: "ok",
            operation: "generate",
            value: decisions.shift(),
            memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
            performance,
          };
        },
      },
      {
        async execute() {
          return completed("print('x')");
        },
      },
    ).run({ task: "Inspect files.", modelId: "test-model" });
    expect(prompts[1]).toContain("Use a flat top-level program");
    expect(prompts[1]).toContain("no nested `try`/`except`");
  });
});

describe("AgentLoop deliverable fact rendering", () => {
  it("normalizes task-declared fact separators before execution", () => {
    const decision = normalizeDeliverableFactRendering(
      {
        action: "execute",
        language: "python",
        source: "print(f'{label}: {value}')\nprint('TOTAL_VALUE:12')",
        summary: "Create",
      },
      "Create report.pdf and label TOTAL_VALUE.",
    );
    expect(decision).toMatchObject({
      action: "execute",
      source: "print(f'{label}={value}')\nprint('TOTAL_VALUE=12')",
    });
  });
});

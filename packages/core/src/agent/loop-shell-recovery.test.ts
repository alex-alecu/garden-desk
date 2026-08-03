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

function capturingInference(
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

describe("AgentLoop shell command limit", () => {
  it("rejects a command at the 4K boundary and requires a source action", async () => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const repaired = { ...completed, source: "print('repaired')" };
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "shell", command: "x".repeat(4_096), summary: "Run" },
          { action: "execute", language: "python", source: repaired.source, summary: "Repair" },
          { action: "respond", response: "Done." },
        ],
        prompts,
        schemas,
      ),
      executor([repaired], calls),
    );

    const result = await loop.run({ task: "Inspect input", modelId: "test-model" });

    expect(calls).toEqual([repaired.source]);
    expect(result.executions).toEqual([repaired]);
    expect(prompts[1]).toContain("reached the 4,096-character command limit");
    expect(prompts[1]).toContain("writes the complete source to a workspace file");
    expect(JSON.stringify(schemas[0])).toContain(
      '"command":{"type":"array","items":{"type":"string","minLength":1},"minItems":1,"maxItems":1}',
    );
    expect(JSON.stringify(schemas[0])).not.toContain('"maxLength":4096');
    expect(schemas[1]).not.toHaveProperty("oneOf");
  });
});

describe("AgentLoop embedded shell source", () => {
  it.each([
    `python3 -c "print('salary')"`,
    `python314 -c "print('salary')"`,
    "python3 - <<'PY'\nprint('salary')\nPY",
  ])("rejects embedded Python source before execution: %s", async (embedded) => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const repaired = { ...completed, source: "print('salary')" };
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "shell", command: embedded, summary: "Search" },
          { action: "execute", language: "python", source: repaired.source, summary: "Search" },
          { action: "respond", response: "Done." },
        ],
        prompts,
        schemas,
      ),
      executor([repaired], calls),
    );

    const result = await loop.run({ task: "Find salary entries", modelId: "test-model" });

    expect(calls).toEqual([repaired.source]);
    expect(result.executions).toEqual([repaired]);
    expect(prompts[1]).toContain("embedded a Python or Node program");
    expect(prompts[1]).toContain("executes it without shell quoting");
    expect(schemas[1]).not.toHaveProperty("oneOf");
  });
});

function shellResult(
  command: string,
  result: Pick<AgentExecutionResult, "exitCode" | "stdout" | "stderr" | "termination">,
): AgentExecutionResult {
  return {
    language: "shell",
    path: null,
    source: null,
    command,
    durationMs: 1,
    artifacts: [],
    ...result,
  };
}

describe("AgentLoop source discovery repair", () => {
  it.each([
    {
      name: "failed",
      result: {
        exitCode: 2,
        stdout: "",
        stderr: "grep: missing operand\n",
        termination: "crash" as const,
      },
    },
    {
      name: "empty",
      result: { exitCode: 0, stdout: "", stderr: "", termination: "completed" as const },
    },
  ])("requires Python or Node source after $name shell discovery", async ({ result }) => {
    const command = "find /source -type f";
    const repaired = { ...completed, source: "print('/source/src/rules.unknown')" };
    const calls: string[] = [];
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    await new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "shell", command, summary: "Discover" },
          { action: "execute", language: "python", source: repaired.source, summary: "Recover" },
          { action: "respond", response: "Done." },
        ],
        prompts,
        schemas,
      ),
      executor([shellResult(command, result), repaired], calls),
    ).run({
      task: "Inspect this codebase and locate the file defining the pricing rule.",
      modelId: "test-model",
    });

    expect(calls).toEqual([command, repaired.source]);
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(prompts[1]).toContain("After failed or empty shell discovery");
    expect(prompts[1]).toContain("Do not restrict initial source discovery");
  });
});

describe("AgentLoop source allowlist rejection", () => {
  it("rejects a guessed source extension allowlist during combined XLSX work", async () => {
    const filtered = "for file in files:\n    if file.endswith(('.py', '.js')): print(file)";
    const repaired = { ...completed, source: "for file in files:\n    print(file)" };
    const calls: string[] = [];
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    await new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "python", source: filtered, summary: "Discover" },
          { action: "execute", language: "python", source: repaired.source, summary: "Recover" },
          { action: "respond", response: "Done." },
        ],
        prompts,
        schemas,
      ),
      executor([repaired], calls),
    ).run({
      task: "Inspect this codebase, locate the pricing rule, and analyze every XLSX workbook.",
      modelId: "test-model",
    });

    expect(calls).toEqual([repaired.source]);
    expect(prompts[1]).toContain("guessed extension allowlist");
    expect(prompts[1]).toContain("attempt to read every ordinary file");
    expect(prompts[1]).toContain("source-discovery-only");
    expect(schemas[1]).not.toHaveProperty("oneOf");
    expect(JSON.stringify(schemas[1])).toContain('"maxItems":40');
  });
});

function failedShellResult(command: string): AgentExecutionResult {
  return {
    language: "shell",
    path: null,
    source: null,
    command,
    exitCode: 2,
    stdout: "",
    stderr: "/bin/sh: syntax error: unterminated quoted string\n",
    durationMs: 1,
    termination: "crash",
    artifacts: [],
  };
}

describe("AgentLoop shell quote repair", () => {
  it("explains an unterminated shell quote and switches the repair to source", async () => {
    const command = `printf "salary`;
    const failed = failedShellResult(command);
    const repaired = { ...completed, source: "print('salary')" };
    const calls: string[] = [];
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(
      capturingInference(
        [
          { action: "execute", language: "shell", command, summary: "Search" },
          { action: "execute", language: "python", source: repaired.source, summary: "Repair" },
          { action: "respond", response: "Done." },
        ],
        prompts,
        schemas,
      ),
      executor([failed, repaired], calls),
    );

    const result = await loop.run({ task: "Find salary entries", modelId: "test-model" });

    expect(calls).toEqual([command, repaired.source]);
    expect(result.executions).toEqual([failed, repaired]);
    expect(prompts[1]).toContain("failed because it contained an unterminated quoted string");
    expect(prompts[1]).toContain("Do not repair it as another shell command");
    expect(schemas[1]).not.toHaveProperty("oneOf");
  });
});

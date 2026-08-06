import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { expect } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import type { AgentExecutor } from "./loop.js";

export const completed: Exclude<AgentExecutionResult, { language: "shell" }> = {
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

export function completeXlsx(stdout: string, total = 1): string {
  return `${stdout.trim()}\nVAULT_PROGRESS_DONE=${total}\nVAULT_PROGRESS_TOTAL=${total}\nVAULT_PROGRESS_COMPLETE=1\n`;
}

export function inference(
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
}

export function executor(results: AgentExecutionResult[], calls: string[]): AgentExecutor {
  return {
    async execute(input) {
      calls.push(input.language === "shell" ? input.command : input.source);
      const result = results.shift();
      if (result === undefined) throw new Error("Missing fake execution result.");
      return result;
    },
  };
}

export function execute(source: string, summary: string): AgentDecision {
  return { action: "execute", language: "python", source, summary };
}

export function expectBoundedSourceSchema(schema: Record<string, unknown>): void {
  expect(schema).toMatchObject({
    properties: { source: { maxItems: 160 }, summary: { type: "string" } },
  });
}

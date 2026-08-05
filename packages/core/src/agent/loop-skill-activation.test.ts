import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";

const performance = {
  promptTokens: 10,
  outputTokens: 5,
  promptDurationMs: 100,
  generationDurationMs: 500,
  totalDurationMs: 600,
};

function inference(
  decisions: AgentDecision[],
  prompts: string[],
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      prompts.push(input.prompt);
      const value = decisions.shift();
      if (value === undefined) throw new Error("Missing fake decision.");
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

describe("model-requested skill activation", () => {
  it("loads a validated catalog skill on a fresh planning turn before executing", async () => {
    const prompts: string[] = [];
    const source = "print('done')";
    const result = await new AgentLoop(
      inference(
        [
          {
            action: "execute",
            language: "python",
            source,
            summary: "Request guidance",
            skills: ["docx-documents"],
          },
          { action: "execute", language: "python", source, summary: "Create output", skills: [] },
          { action: "respond", response: "Done.", skills: [] },
        ],
        prompts,
      ),
      {
        async execute(): Promise<AgentExecutionResult> {
          return {
            language: "python",
            path: "steps/0001.py",
            source,
            command: null,
            exitCode: 0,
            stdout: "done\n",
            stderr: "",
            durationMs: 1,
            termination: "completed",
            artifacts: [],
          };
        },
      },
    ).run({ task: "Prepare the requested deliverable.", modelId: "test-model" });

    expect(result.response).toBe("Done.");
    expect(result.executions).toHaveLength(1);
    expect(prompts[0]).toContain("docx-documents (available)");
    expect(prompts[0]).not.toContain("## Active skill: docx-documents");
    expect(prompts[1]).toContain("docx-documents (active)");
    expect(prompts[1]).toContain("## Active skill: docx-documents");
  });
});

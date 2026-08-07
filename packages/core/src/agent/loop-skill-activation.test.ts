import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";
import { activateRequestedSkills, newProgress } from "./loop-turn.js";

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
  it("accepts a temporarily suppressed skill request only once", () => {
    const progress = newProgress();
    progress.lastRejectedProgramReason = "source_allowlist";
    const input = { task: "Inspect the selected source tree.", modelId: "test-model" };
    const traced = {
      decision: {
        action: "execute" as const,
        language: "python" as const,
        source: "print('done')",
        summary: "Request workbook guidance",
        skills: ["xlsx-workbooks"],
      },
    };

    expect(activateRequestedSkills(input, progress, traced)).toBe(true);
    expect(activateRequestedSkills(input, progress, traced)).toBe(false);
    expect([...(progress.requestedSkills ?? [])]).toEqual(["xlsx-workbooks"]);
  });
});

describe("active model-requested skills", () => {
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

describe("skill activation progress messages", () => {
  it("does not repeat the initial planning message after activating a skill", async () => {
    const prompts: string[] = [];
    const source = "print('done')";
    const summaries: string[] = [];
    await new AgentLoop(
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
    ).run({
      task: "Prepare the requested deliverable.",
      modelId: "test-model",
      onEvent: (type, summary) => {
        if (type === "inference.started") summaries.push(summary);
      },
    });

    const planning = summaries.filter(
      (summary) => summary === "Loading the local model and planning the task.",
    );
    expect(planning).toHaveLength(1);
    expect(summaries[1]).toBe("Applying the requested guidance and planning the task.");
  });
});

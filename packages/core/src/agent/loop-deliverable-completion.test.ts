import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { rejectsUnbackedResponse, requestsDeliverable } from "./deliverable-completion.js";
import { AgentLoop } from "./loop.js";

const performance = {
  promptTokens: 10,
  outputTokens: 5,
  promptDurationMs: 100,
  generationDurationMs: 500,
  totalDurationMs: 600,
};

const TASK = "Write a short story for children in word & pdf docs";
const docxArtifact = {
  name: "story.docx",
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytesBase64: "AA==",
};

function inference(
  decisions: AgentDecision[],
  prompts: string[],
  schemas: Array<Record<string, unknown>> = [],
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      prompts.push(input.prompt);
      schemas.push(input.jsonSchema as Record<string, unknown>);
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

function executor(artifacts: AgentExecutionResult["artifacts"]) {
  return {
    async execute(): Promise<AgentExecutionResult> {
      return {
        language: "python",
        path: "steps/0001.py",
        source: "print('done')",
        command: null,
        exitCode: 0,
        stdout: "created\n",
        stderr: "",
        durationMs: 1,
        termination: "completed",
        artifacts,
      };
    },
  };
}

describe("deliverable request detection", () => {
  it("detects requested document deliverables without matching explanatory tasks", () => {
    expect(requestsDeliverable(TASK, true)).toBe(true);
    expect(requestsDeliverable("Create a styled report.", true)).toBe(true);
    expect(requestsDeliverable("Explain these formats.", true)).toBe(false);
    expect(requestsDeliverable("Create a styled report.", false)).toBe(false);
  });
});

function rejects(response: string, artifacts: string[] = [], task = TASK): boolean {
  return rejectsUnbackedResponse({
    decision: { action: "respond", response, artifacts, skills: [] },
    deliverableSkillActive: true,
    executions: [],
    task,
  });
}

describe("unbacked final response rejection", () => {
  it("rejects a promise-only response when nothing was executed or produced", () => {
    expect(
      rejects(
        "I will create a short story for children titled 'The Brave Little Squirrel' and save it as both a DOCX and a PDF document in the /workspace directory.",
      ),
    ).toBe(true);
  });

  it("rejects a clarifying question that performs no requested work", () => {
    expect(
      rejects("To get started, please let me know if you have a specific theme in mind."),
    ).toBe(true);
  });

  it("accepts a response backed by a declared deliverable", () => {
    expect(rejects("I will summarize what was written.", ["story.docx"])).toBe(false);
  });

  it("does not reject a response for a task that requests no produced file", () => {
    expect(rejects("I will explain it.", [], "Explain these formats.")).toBe(false);
  });
});

describe("AgentLoop deliverable completion", () => {
  it("refuses a promise-only answer and completes the task with a real execution", async () => {
    const prompts: string[] = [];
    const summaries: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const result = await new AgentLoop(
      inference(
        [
          {
            action: "respond",
            response:
              "I will create a short story titled 'The Brave Little Squirrel' and save it as DOCX and PDF.",
            artifacts: [],
            skills: [],
          },
          {
            action: "execute",
            language: "python",
            source: "print('done')",
            summary: "Create the requested documents",
            skills: [],
          },
          { action: "respond", response: "Created story.docx and story.pdf.", skills: [] },
        ],
        prompts,
        schemas,
      ),
      executor([
        docxArtifact,
        { name: "story.pdf", mediaType: "application/pdf", bytesBase64: "AA==" },
      ]),
    ).run({
      task: TASK,
      modelId: "test-model",
      onEvent: (type, summary) => {
        if (type === "inference.started") summaries.push(summary);
      },
    });

    expect(result.response).toBe("Created story.docx and story.pdf.");
    expect(result.executions).toHaveLength(1);
    expect(JSON.stringify(schemas[1])).not.toContain('"respond"');
    expect(prompts[1]).toContain("only described or offered work that was never performed");
    expect(summaries[1]).toBe("Preparing the requested files.");
  });
});

describe("AgentLoop execution-backed deliverable response", () => {
  it("keeps accepting an execution-backed response for a deliverable task", async () => {
    const prompts: string[] = [];
    const result = await new AgentLoop(
      inference(
        [
          {
            action: "execute",
            language: "python",
            source: "print('done')",
            summary: "Create the requested documents",
            skills: [],
          },
          {
            action: "respond",
            response: "Created story.docx.",
            artifacts: ["story.docx"],
            skills: [],
          },
        ],
        prompts,
      ),
      executor([docxArtifact]),
    ).run({ task: TASK, modelId: "test-model" });

    expect(result.response).toBe("Created story.docx.");
    expect(result.artifacts).toEqual(["story.docx"]);
    expect(result.executions).toHaveLength(1);
  });
});

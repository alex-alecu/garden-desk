import { AgentEventSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import type { DurableAgentHistory } from "./history.js";
import { AgentLoop } from "./loop.js";

function capturingInference(
  prompts: string[],
  schemas: Array<Record<string, unknown>>,
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      prompts.push(input.prompt);
      schemas.push(input.jsonSchema);
      return {
        protocolVersion: 1,
        requestId: "test",
        status: "ok",
        operation: "generate",
        value: { action: "respond", response: "Ready." },
        memory: { cpuRamBytes: 1, gpuVramBytes: 1, budgetBytes: 1, detectedGpuVramBytes: 1 },
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

function extractionHistory(source: string): DurableAgentHistory {
  const event = AgentEventSchema.parse({
    id: "3f1d0a5c-7c14-4f4e-9d0f-2b4c5a6e7f80",
    runId: "1f2e3d4c-5b6a-4798-8b9c-0d1e2f3a4b5c",
    sequence: 0,
    type: "execution.completed",
    summary: "Finished this step.",
    language: "python",
    path: "steps/1.py",
    source,
    exitCode: 0,
    stdout: "CONTRACT INDIVIDUAL DE MUNCA",
    stderr: "",
    durationMs: 2_500,
    termination: "completed",
    createdAt: "2026-07-29T06:59:10.937Z",
  });
  return { messages: [], runs: [{ state: "succeeded", events: [event] }] };
}

describe("AgentLoop attachment instructions", () => {
  it("directs attached PDFs to their exact immutable path with pypdf", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(capturingInference(prompts, schemas), {
      async execute() {
        throw new Error("Attached PDF inspection was not expected to execute in this schema test.");
      },
    });

    await loop.run({
      task: "Review the contract",
      modelId: "test-model",
      inputNames: ["contract.pdf"],
    });

    expect(prompts[0]).toContain('"path":"/run/attachments/01-contract.pdf"');
    expect(prompts[0]).toContain("- pdf-documents (active)");
    expect(prompts[0]).toContain("Use `pypdf` for reading and structural operations.");
    expect(prompts[0]).toContain("base answers on text extracted from the real pages");
    expect(schemas[0]).toMatchObject({
      properties: { action: { const: "execute" }, language: { enum: ["python", "node"] } },
    });
  });
});

describe("AgentLoop attachment history", () => {
  it("stops forcing extraction when an earlier session run already read the PDF", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(capturingInference(prompts, schemas), {
      async execute() {
        throw new Error("A re-extraction was not expected after a recorded extraction.");
      },
    });

    const result = await loop.run({
      task: "Give me a summary",
      modelId: "test-model",
      inputNames: ["contract.pdf"],
      history: extractionHistory(
        "from pypdf import PdfReader\nPdfReader('/run/attachments/01-contract.pdf')",
      ),
    });

    expect(result.response).toBe("Ready.");
    expect(schemas[0]).toHaveProperty("oneOf");
  });

  it("still forces extraction when history read a different attachment", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(capturingInference(prompts, schemas), {
      async execute() {
        throw new Error("Attached PDF inspection was not expected to execute in this schema test.");
      },
    });

    await loop.run({
      task: "Give me a summary",
      modelId: "test-model",
      inputNames: ["contract.pdf"],
      history: extractionHistory(
        "from pypdf import PdfReader\nPdfReader('/run/attachments/01-other.pdf')",
      ),
    });

    expect(schemas[0]).toMatchObject({
      properties: { action: { const: "execute" }, language: { enum: ["python", "node"] } },
    });
  });
});

describe("AgentLoop multiple attachment history", () => {
  it("still forces extraction when history read only one of multiple PDFs", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const loop = new AgentLoop(capturingInference(prompts, schemas), {
      async execute() {
        throw new Error("Attached PDF inspection was not expected to execute in this schema test.");
      },
    });

    await loop.run({
      task: "Compare both contracts",
      modelId: "test-model",
      inputNames: ["first.pdf", "second.pdf"],
      history: extractionHistory(
        "from pypdf import PdfReader\nPdfReader('/run/attachments/01-first.pdf')",
      ),
    });

    expect(schemas[0]).toMatchObject({
      properties: { action: { const: "execute" }, language: { enum: ["python", "node"] } },
    });
  });
});

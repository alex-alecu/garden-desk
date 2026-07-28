import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";

describe("AgentLoop attachment instructions", () => {
  it("directs attached PDFs to their exact immutable path with pypdf", async () => {
    const prompts: string[] = [];
    const schemas: Array<Record<string, unknown>> = [];
    const inference: Pick<InferenceService, "generate"> = {
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
    const loop = new AgentLoop(inference, {
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
    expect(prompts[0]).toContain(
      "use one short Python source action with from pypdf import PdfReader",
    );
    expect(prompts[0]).toContain("Never cat a PDF");
    expect(schemas[0]).toMatchObject({
      properties: { action: { const: "execute" }, language: { const: "python" } },
    });
  });
});

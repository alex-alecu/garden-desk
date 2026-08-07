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
  schemas: Array<Record<string, unknown>>,
): Pick<InferenceService, "generate"> {
  return {
    async generate(input) {
      schemas.push(input.jsonSchema);
      const value = decisions.shift();
      if (value === undefined) throw new Error("Missing fake agent decision.");
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

describe("AgentLoop artifact finalization", () => {
  it("uses a final response turn when verified progress also produced a deliverable", async () => {
    const source = "print('done')";
    const artifact = {
      name: "result.xlsx",
      mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytesBase64: Buffer.from("workbook").toString("base64"),
    };
    const schemas: Array<Record<string, unknown>> = [];
    const result = await new AgentLoop(
      inference(
        [
          { action: "execute", language: "python", source, summary: "Create workbook" },
          { action: "respond", response: "The workbook is ready.", artifacts: ["result.xlsx"] },
        ],
        schemas,
      ),
      {
        async execute(): Promise<AgentExecutionResult> {
          return {
            language: "python",
            path: "steps/0001.py",
            source,
            command: null,
            exitCode: 0,
            stdout:
              "ROWS=1\nVAULT_PROGRESS_DONE=1\nVAULT_PROGRESS_TOTAL=1\nVAULT_PROGRESS_COMPLETE=1\n",
            stderr: "",
            durationMs: 10,
            termination: "completed",
            artifacts: [artifact],
          };
        },
      },
    ).run({ task: "Create an Excel workbook.", modelId: "test-model" });

    expect(result.response).toBe("ROWS=1");
    expect(result.artifacts).toEqual(["result.xlsx"]);
    expect(schemas).toHaveLength(2);
    expect(schemas[1]).toHaveProperty("oneOf");
  });
});

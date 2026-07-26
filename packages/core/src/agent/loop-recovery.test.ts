import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { AgentLoop } from "./loop.js";

describe("AgentLoop structured recovery", () => {
  it("retries one missing Gemma function call with an exact stronger prompt", async () => {
    const prompts: string[] = [];
    let attempt = 0;
    const model: Pick<InferenceService, "generate"> = {
      async generate(input) {
        prompts.push(input.prompt);
        attempt += 1;
        if (attempt === 1) throw new Error("structured_tool_call_required");
        return {
          protocolVersion: 1,
          requestId: "recovery-test",
          status: "ok",
          operation: "generate",
          value: { action: "respond", response: "Recovered." },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance: {
            promptTokens: 1,
            outputTokens: 1,
            promptDurationMs: 1,
            generationDurationMs: 1,
            totalDurationMs: 2,
          },
        };
      },
    };
    const result = await new AgentLoop(model, {
      async execute() {
        throw new Error("unexpected_execution");
      },
    }).run({ task: "Reply", modelId: "gemma-4-test" });

    expect(result.response).toBe("Recovered.");
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("Your previous attempt did not call a function.");
    expect(prompts[1]).toMatch(/Call exactly one available function with your answer\.$/u);
  });
});

import { describe, expect, it } from "vitest";
import type { InferencePort } from "./inference.js";
import type { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";
import { InferenceSupervisor } from "./supervisor.js";

const chatInput = {
  modelId: "test-model",
  messages: [{ role: "user" as const, text: "ready" }],
  tools: [],
  contextSize: 512,
  maxTokens: 8,
  temperature: 0,
};

function port(): InferencePort {
  return {
    async unload() {
      return true;
    },
    async execute(execution) {
      execution.onResponseDelta?.("Streaming ");
      execution.onResponseDelta?.("now.");
      return {
        protocolVersion: 1,
        requestId: execution.request.requestId,
        status: "ok",
        operation: "chat",
        text: "Streaming now.",
        toolCalls: [],
        stopReason: "text",
        memory: {
          cpuRamBytes: 1,
          gpuVramBytes: 1,
          budgetBytes: execution.memoryBudgetBytes,
          detectedGpuVramBytes: execution.memoryBudgetBytes,
          contextSizeTokens: 512,
        },
        performance: {
          promptTokens: 1,
          outputTokens: 2,
          promptDurationMs: 1,
          generationDurationMs: 2,
          totalDurationMs: 3,
        },
      };
    },
  };
}

describe("M3 response streaming", () => {
  it("forwards generated response deltas from the resident worker", async () => {
    const deltas: string[] = [];
    const models = {
      async resolve() {
        return { path: "model.gguf", async dispose() {} };
      },
    } as unknown as ModelResolver;
    const inference = new InferenceSupervisor(
      port(),
      models,
      new ResourceScheduler(12 * 1024 ** 3),
      () => undefined,
    );

    await inference.chat(chatInput, undefined, {
      onResponseDelta: (delta) => deltas.push(delta),
    });

    expect(deltas).toEqual(["Streaming ", "now."]);
  });
});

import type { AuditEventInput } from "@gardendesk/shared";
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

function chatSuccess(execution: Parameters<InferencePort["execute"]>[0]) {
  return {
    protocolVersion: 2 as const,
    requestId: execution.request.requestId,
    status: "ok" as const,
    operation: "chat" as const,
    text: "ready",
    toolCalls: [],
    stopReason: "text" as const,
    contextUsedTokens: 1,
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: execution.memoryBudgetBytes,
      detectedGpuMemoryBytes: execution.memoryBudgetBytes,
      gpuMemoryKind: "unified" as const,
      backend: "metal" as const,
      selectedDeviceCount: 1 as const,
      contextSizeTokens: 512,
    },
    performance: {
      promptTokens: 1,
      outputTokens: 1,
      promptDurationMs: 1,
      generationDurationMs: 1,
      totalDurationMs: 2,
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function cancellationPort(started: ReturnType<typeof deferred>) {
  const counts = { executions: 0, unloads: 0 };
  const port: InferencePort = {
    async unload() {
      counts.unloads += 1;
      return true;
    },
    async execute(execution) {
      counts.executions += 1;
      if (counts.executions !== 2) return chatSuccess(execution);
      started.resolve();
      return await new Promise((accept) => {
        execution.signal?.addEventListener(
          "abort",
          () =>
            accept({
              protocolVersion: 2,
              requestId: execution.request.requestId,
              status: "error",
              error: { code: "cancelled", message: "Inference failed." },
            }),
          { once: true },
        );
      });
    },
  };
  return { counts, port };
}

const models = {
  async resolve() {
    return { path: "model.gguf", async dispose() {} };
  },
} as unknown as ModelResolver;

describe("M3 acknowledged inference cancellation", () => {
  it("keeps the model ready for the next chat", async () => {
    const events: AuditEventInput[] = [];
    const started = deferred();
    const { counts, port } = cancellationPort(started);
    const inference = new InferenceSupervisor(
      port,
      models,
      new ResourceScheduler(12 * 1024 ** 3),
      (event) => events.push(event),
    );
    await expect(inference.chat(chatInput)).resolves.toMatchObject({ text: "ready" });
    const controller = new AbortController();
    const cancelled = inference.chat(chatInput, controller.signal);
    await started.promise;

    controller.abort(new DOMException("stop", "AbortError"));

    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    await expect(inference.modelStatus()).resolves.toMatchObject({
      state: "ready",
      memoryBudgetBytes: 12 * 1024 ** 3,
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
    });
    expect(counts.unloads).toBe(0);
    await expect(inference.chat(chatInput)).resolves.toMatchObject({ text: "ready" });
    expect(counts).toEqual({ executions: 3, unloads: 0 });
    expect(events).toMatchObject([
      { type: "inference.chat", outcome: "succeeded" },
      { type: "inference.chat", outcome: "failed", metadata: { code: "cancelled" } },
      { type: "inference.chat", outcome: "succeeded" },
    ]);
  });
});

import type { AuditEventInput } from "@vault/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferencePort } from "./inference.js";
import type { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";
import { InferenceSupervisor } from "./supervisor.js";

const GiB = 1024 ** 3;
const generationInput = {
  modelId: "test-model",
  prompt: "ready",
  jsonSchema: { type: "object" },
  contextSize: 512,
  maxTokens: 8,
};

afterEach(() => vi.useRealTimers());

function modelResolver(): ModelResolver {
  return {
    async resolve() {
      return { path: "model.gguf", async dispose() {} };
    },
  } as unknown as ModelResolver;
}

async function supervisor(port: InferencePort, events: AuditEventInput[]) {
  return new InferenceSupervisor(port, modelResolver(), new ResourceScheduler(12 * GiB), (event) =>
    events.push(event),
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function success(execution: Parameters<InferencePort["execute"]>[0]) {
  return {
    protocolVersion: 1 as const,
    requestId: execution.request.requestId,
    status: "ok" as const,
    operation: "generate" as const,
    value: { result: "ready" },
    memory: {
      cpuRamBytes: 1,
      gpuVramBytes: 1,
      budgetBytes: execution.memoryBudgetBytes,
      detectedGpuVramBytes: execution.memoryBudgetBytes,
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

describe("M3 queued resident worker", () => {
  it("queues overlapping generations on the active resident worker", async () => {
    vi.useFakeTimers();
    const events: AuditEventInput[] = [];
    const started = deferred();
    const firstGenerationFinished = deferred();
    const executions: Array<string | number> = [];
    const timeouts: number[] = [];
    let unloads = 0;
    const port: InferencePort = {
      async unload() {
        unloads += 1;
        return true;
      },
      async execute(execution) {
        executions.push(execution.request.requestId);
        timeouts.push(execution.timeoutMs);
        started.resolve();
        if (executions.length === 1) await firstGenerationFinished.promise;
        return success(execution);
      },
    };
    const inference = await supervisor(port, events);
    const first = inference.generate(generationInput);
    await started.promise;
    const second = inference.generate(generationInput);
    await Promise.resolve();
    expect(executions).toHaveLength(1);
    expect(unloads).toBe(0);
    vi.advanceTimersByTime(60_000);
    firstGenerationFinished.resolve();
    await expect(first).resolves.toMatchObject({ value: { result: "ready" } });
    await expect(second).resolves.toMatchObject({ value: { result: "ready" } });
    expect(executions).toHaveLength(2);
    expect(timeouts).toEqual([300_000, 300_000]);
  });
});

describe("M3 queued resident worker cancellation", () => {
  it("cancels without starting or overtaking the active worker", async () => {
    const started = deferred();
    const firstGenerationFinished = deferred();
    const executions: Array<string | number> = [];
    const port: InferencePort = {
      async unload() {
        return true;
      },
      async execute(execution) {
        executions.push(execution.request.requestId);
        started.resolve();
        if (executions.length === 1) await firstGenerationFinished.promise;
        return success(execution);
      },
    };
    const inference = await supervisor(port, []);
    const first = inference.generate(generationInput);
    await started.promise;
    const controller = new AbortController();
    const cancelled = inference.generate(generationInput, controller.signal);
    const third = inference.generate(generationInput);
    controller.abort(new DOMException("Cancelled.", "AbortError"));

    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    expect(executions).toHaveLength(1);
    firstGenerationFinished.resolve();
    await expect(first).resolves.toMatchObject({ value: { result: "ready" } });
    await expect(third).resolves.toMatchObject({ value: { result: "ready" } });
    expect(executions).toHaveLength(2);
  });
});

describe("M3 resident worker recovery", () => {
  it("keeps the resident model for recoverable structured and generation-limit misses", async () => {
    const failures = ["structured_tool_call_required", "generation_token_limit"];
    let unloads = 0;
    const port: InferencePort = {
      async unload() {
        unloads += 1;
        return true;
      },
      async execute(execution) {
        const message = failures.shift();
        if (message === undefined) return success(execution);
        return {
          protocolVersion: 1,
          requestId: execution.request.requestId,
          status: "error",
          error: { code: "internal", message },
        };
      },
    };
    const inference = await supervisor(port, []);
    await expect(inference.generate(generationInput)).rejects.toThrow(
      "structured_tool_call_required",
    );
    await expect(inference.generate(generationInput)).rejects.toThrow("generation_token_limit");
    await expect(inference.generate(generationInput)).resolves.toMatchObject({
      value: { result: "ready" },
    });
    expect(unloads).toBe(0);
    await expect(inference.modelStatus()).resolves.toMatchObject({ state: "ready" });
  });

  it("allows a 32K generation enough bounded time to reach its token limit", async () => {
    vi.useFakeTimers();
    let timeoutMs = 0;
    const inference = await supervisor(
      {
        async unload() {
          return true;
        },
        async execute(execution) {
          timeoutMs = execution.timeoutMs;
          return success(execution);
        },
      },
      [],
    );

    await inference.generate({ ...generationInput, maxTokens: 32_768 });

    expect(timeoutMs).toBe(1_966_080);
  });
});

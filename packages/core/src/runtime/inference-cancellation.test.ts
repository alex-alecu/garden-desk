// biome-ignore lint/style/noRestrictedImports: this containment test starts an isolated worker process.
import { spawn } from "node:child_process";
import type { AuditEventInput } from "@vault/shared";
import {
  InferenceWorkerClient,
  type NativeWorkerHandle,
  type NativeWorkerLauncher,
  type NativeWorkerLaunchRequest,
} from "@vault/workers";
import { describe, expect, it, vi } from "vitest";
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
const memoryBudgetBytes = 12 * 1024 ** 3;

function chatSuccess(execution: Parameters<InferencePort["execute"]>[0]) {
  return {
    protocolVersion: 2 as const,
    requestId: execution.request.requestId,
    status: "ok" as const,
    operation: "chat" as const,
    text: "ready",
    toolCalls: [],
    stopReason: "text" as const,
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

class ScriptLauncher implements NativeWorkerLauncher {
  launches = 0;
  private readonly handles: NativeWorkerHandle[] = [];

  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    this.launches += 1;
    const child = spawn(process.execPath, ["-e", workerScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const handle = {
      process: child,
      async dispose() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
    };
    this.handles.push(handle);
    return handle;
  }

  async dispose(): Promise<void> {
    await Promise.all(this.handles.splice(0).map(async (handle) => await handle.dispose()));
  }
}

const workerScript = `
let pending = Buffer.alloc(0);
function send(value) {
  const payload = Buffer.from(JSON.stringify(value));
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  process.stdout.write(frame);
}
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32BE(0);
    if (pending.length < 4 + length) return;
    const frame = JSON.parse(pending.subarray(4, 4 + length));
    pending = pending.subarray(4 + length);
    if (frame.operation === "cancel") continue;
    send({protocolVersion: 2, requestId: frame.requestId, status: "stream", event: "thinking.delta", text: "started"});
    if (frame.messages?.[0]?.text !== "next") continue;
    send({
      protocolVersion: 2,
      requestId: frame.requestId,
      status: "ok",
      operation: "chat",
      text: "ready",
      toolCalls: [],
      stopReason: "text",
      memory: {cpuRamBytes: 1, gpuMemoryBytes: 1, budgetBytes: 1024, detectedGpuMemoryBytes: 1024, gpuMemoryKind: "unified", backend: "metal", selectedDeviceCount: 1},
      performance: {promptTokens: 1, outputTokens: 1, promptDurationMs: 1, generationDurationMs: 1, totalDurationMs: 2},
    });
  }
});
`;

async function disposeInference(
  inference: InferenceSupervisor,
  launcher: ScriptLauncher,
): Promise<void> {
  vi.useRealTimers();
  try {
    await inference.close();
  } finally {
    await launcher.dispose();
  }
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
      new ResourceScheduler(memoryBudgetBytes),
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
      memoryBudgetBytes,
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

describe("M3 automatic inference interruption", () => {
  it("keeps the model loaded until explicit unload after automatic interruption", async () => {
    vi.useFakeTimers();
    const launcher = new ScriptLauncher();
    const client = new InferenceWorkerClient(launcher, "unused");
    const inference = new InferenceSupervisor(
      client,
      models,
      new ResourceScheduler(memoryBudgetBytes),
      () => undefined,
    );
    try {
      const stopped = deferred();
      const controller = new AbortController();
      const cancelled = inference.chat(chatInput, controller.signal, {
        onThinkingDelta: stopped.resolve,
      });
      const cancelledResult = expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
      await stopped.promise;

      controller.abort(new DOMException("stop", "AbortError"));
      await vi.advanceTimersByTimeAsync(1_000);

      await cancelledResult;
      await expect(inference.modelStatus()).resolves.toMatchObject({ state: "ready" });

      const timed = deferred();
      const timedOut = inference.chat(
        { ...chatInput, messages: [{ role: "user", text: "timeout" }] },
        undefined,
        { onThinkingDelta: timed.resolve },
      );
      const timeoutResult = expect(timedOut).rejects.toMatchObject({ code: "timeout" });
      await timed.promise;
      await vi.advanceTimersByTimeAsync(301_000);
      await timeoutResult;

      vi.useRealTimers();
      await expect(
        inference.chat({ ...chatInput, messages: [{ role: "user", text: "next" }] }),
      ).resolves.toMatchObject({
        text: "ready",
      });
      expect(launcher.launches).toBe(1);
      await expect(inference.unloadModel()).resolves.toBe(true);
      await expect(inference.modelStatus()).resolves.toMatchObject({ state: "unloaded" });
    } finally {
      await disposeInference(inference, launcher);
    }
  });
});

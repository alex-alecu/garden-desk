// biome-ignore lint/style/noRestrictedImports: this containment test starts an isolated worker process.
import { spawn } from "node:child_process";
import { InferenceWorkerRequestSchema } from "@vault/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "../native/launcher.js";
import { InferenceWorkerClient } from "./client.js";

class ScriptLauncher implements NativeWorkerLauncher {
  launches = 0;

  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    this.launches += 1;
    const child = spawn(process.execPath, ["-e", workerScript], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      process: child,
      async dispose() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
    };
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
function done(request) {
  send({
    protocolVersion: 2,
    requestId: request.requestId,
    status: "ok",
    operation: "chat",
    text: "ready",
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: 1024,
      detectedGpuMemoryBytes: 1024,
      gpuMemoryKind: "unified",
      backend: "metal",
      selectedDeviceCount: 1,
    },
    performance: {promptTokens: 1, outputTokens: 1, promptDurationMs: 1, generationDurationMs: 1, totalDurationMs: 2},
  });
}
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32BE(0);
    if (pending.length < 4 + length) return;
    const frame = JSON.parse(pending.subarray(4, 4 + length));
    pending = pending.subarray(4 + length);
    if (frame.operation === "cancel") {
      if (frame.requestId !== "ignored") {
        send({
          protocolVersion: 2,
          requestId: frame.requestId,
          status: "error",
          error: {code: "cancelled", message: "Inference failed."},
        });
      }
      continue;
    }
    send({protocolVersion: 2, requestId: frame.requestId, status: "stream", event: "thinking.delta", text: "started"});
    if (frame.requestId === "next") done(frame);
  }
});
`;

const chat = (requestId: string) =>
  InferenceWorkerRequestSchema.parse({
    protocolVersion: 2,
    requestId,
    jobId: "00000000-0000-4000-8000-000000000003",
    operation: "chat",
    modelId: "test-model",
    messages: [{ role: "user", text: "ready" }],
    tools: [],
    contextSize: 512,
    maxTokens: 8,
    temperature: 0,
  });

function startedSignal() {
  let markStarted!: () => void;
  const started = new Promise<void>((accept) => {
    markStarted = accept;
  });
  return { markStarted, started };
}

const resident = {
  modelPath: "/approved/model.gguf",
  memoryBudgetBytes: 1024,
  timeoutMs: 30_000,
};

afterEach(() => vi.useRealTimers());

describe("resident inference cancellation", () => {
  it("keeps one resident worker after it acknowledges cancellation", async () => {
    const launcher = new ScriptLauncher();
    const client = new InferenceWorkerClient(launcher, "unused");
    const controller = new AbortController();
    const active = startedSignal();
    const cancelled = client.execute({
      request: chat("cancelled"),
      signal: controller.signal,
      onThinkingDelta: active.markStarted,
      ...resident,
    });
    await active.started;

    controller.abort(new DOMException("stop", "AbortError"));

    await expect(cancelled).resolves.toMatchObject({
      status: "error",
      error: { code: "cancelled" },
    });
    await expect(client.execute({ request: chat("next"), ...resident })).resolves.toMatchObject({
      operation: "chat",
    });
    expect(launcher.launches).toBe(1);
    await expect(client.unload()).resolves.toBe(true);
  });
});

describe("resident inference cancellation timeout", () => {
  it("terminates a resident worker that does not acknowledge cancellation", async () => {
    vi.useFakeTimers();
    const launcher = new ScriptLauncher();
    const client = new InferenceWorkerClient(launcher, "unused");
    const controller = new AbortController();
    const active = startedSignal();
    const pending = client.execute({
      request: chat("ignored"),
      signal: controller.signal,
      onThinkingDelta: active.markStarted,
      ...resident,
    });
    await active.started;

    controller.abort(new DOMException("stop", "AbortError"));

    let rejected = false;
    void pending.catch(() => {
      rejected = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ code: "worker_crash" });
    expect(launcher.launches).toBe(1);
  });
});

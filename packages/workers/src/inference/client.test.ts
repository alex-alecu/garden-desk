import { spawn } from "node:child_process";
import { InferenceWorkerRequestSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "../native/launcher.js";
import { WindowsNativeWorkerLauncher } from "../native/windows.js";
import { InferenceWorkerClient, InferenceWorkerError } from "./client.js";

class ScriptLauncher implements NativeWorkerLauncher {
  launches = 0;

  constructor(private readonly script: string) {}

  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    this.launches += 1;
    const child = spawn(process.execPath, ["-e", this.script], {
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

const residentWorkerScript = `
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
    const request = JSON.parse(pending.subarray(4, 4 + length));
    pending = pending.subarray(4 + length);
    send({protocolVersion: 2, requestId: request.requestId, status: "stream", event: "thinking.delta", text: "Checking locally. "});
    send({protocolVersion: 2, requestId: request.requestId, status: "stream", event: "response.delta", text: "Answering locally. "});
    send({
      protocolVersion: 2,
      requestId: request.requestId,
      status: "ok",
      operation: "generate",
      value: {result: "ok"},
      memory: {
        cpuRamBytes: 1,
        gpuMemoryBytes: 1,
        budgetBytes: 1024,
        detectedGpuMemoryBytes: 1024,
        gpuMemoryKind: "unified" as const,
        backend: "metal" as const,
        selectedDeviceCount: 1 as const,
      },
      performance: {promptTokens: 10, outputTokens: 2, promptDurationMs: 5, generationDurationMs: 4, totalDurationMs: 9}
    });
  }
});
`;

const parallelWorkerScript = `
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
    operation: "generate",
    value: {result: "ok"},
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: 1024,
      detectedGpuMemoryBytes: 1024,
      gpuMemoryKind: "unified" as const,
      backend: "metal" as const,
      selectedDeviceCount: 1 as const,
    },
    performance: {promptTokens: 10, outputTokens: 2, promptDurationMs: 5, generationDurationMs: 4, totalDurationMs: 9}
  });
}
const requests = new Map();
process.stdin.on("data", (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32BE(0);
    if (pending.length < 4 + length) return;
    const frame = JSON.parse(pending.subarray(4, 4 + length));
    pending = pending.subarray(4 + length);
    if (frame.operation === "cancel") {
      const request = requests.get(frame.requestId);
      if (request) done(request);
      continue;
    }
    requests.set(frame.requestId, frame);
    if (frame.requestId === "second") setTimeout(() => done(frame), 10);
  }
});
`;

const probe = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "test",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "probe",
  authorityProbePath: "/private/var/empty/denied",
  outOfScopeReadPath: "/private/var/empty/read-denied",
  outOfScopeWritePath: "/private/var/empty/write-denied",
});

const largeGeneration = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "large-request",
  jobId: "00000000-0000-4000-8000-000000000003",
  operation: "generate",
  modelId: "test-model",
  prompt: "x".repeat(200_000),
  jsonSchema: { type: "object" },
  contextSize: 512,
  maxTokens: 8,
});

function generation(requestId: string) {
  return InferenceWorkerRequestSchema.parse({
    ...largeGeneration,
    requestId,
  });
}

function execute(script: string, timeoutMs = 500, signal?: AbortSignal, request = probe) {
  return new InferenceWorkerClient(new ScriptLauncher(script), "unused").execute({
    request,
    memoryBudgetBytes: 1024,
    timeoutMs,
    ...(signal === undefined ? {} : { signal }),
  });
}

describe("M2 inference worker containment", () => {
  it("contains worker crashes", async () => {
    await expect(execute("process.exit(7)")).rejects.toMatchObject({ code: "worker_crash" });
  });

  it("contains stdin errors when a worker exits before reading a large request", async () => {
    await expect(execute("process.exit(7)", 500, undefined, largeGeneration)).rejects.toMatchObject(
      { code: "worker_crash" },
    );
  });

  it("contains malformed IPC", async () => {
    const script = "process.stdout.write(Buffer.from([0,0,0,1,123]))";
    await expect(execute(script)).rejects.toMatchObject({ code: "malformed_worker_message" });
  });

  it("kills timed-out workers", async () => {
    await expect(execute("setInterval(() => {}, 1000)", 25)).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("kills cancelled workers", async () => {
    const controller = new AbortController();
    const pending = execute("setInterval(() => {}, 1000)", 500, controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(
      (error) => error instanceof InferenceWorkerError && error.code === "cancelled",
    );
  });

  it.skipIf(process.platform === "win32" && process.arch === "x64")(
    "reports unsupported Windows launcher platforms as typed unsupported",
    async () => {
      await expect(
        new WindowsNativeWorkerLauncher().launch({
          workerEntryPath: "unused",
          memoryBudgetBytes: 1024,
        }),
      ).rejects.toMatchObject({ code: "unsupported" });
    },
  );
});

describe("resident inference worker", () => {
  // These cases spawn real Node worker processes, so the timeout must cover process
  // startup on a loaded runner. The timed-out and cancelled cases above keep their
  // short budgets because they assert the timeout and cancellation paths themselves.
  const residentTimeoutMs = 30_000;

  it("reuses one process, routes both text streams, and unloads explicitly", async () => {
    const launcher = new ScriptLauncher(residentWorkerScript);
    const client = new InferenceWorkerClient(launcher, "unused");
    const thinking: string[] = [];
    const responses: string[] = [];
    const execution = {
      request: largeGeneration,
      modelPath: "/approved/model.gguf",
      memoryBudgetBytes: 1024,
      timeoutMs: residentTimeoutMs,
      onThinkingDelta: (text: string) => thinking.push(text),
      onResponseDelta: (text: string) => responses.push(text),
    };

    await expect(client.execute(execution)).resolves.toMatchObject({ operation: "generate" });
    await expect(client.execute(execution)).resolves.toMatchObject({ operation: "generate" });

    expect(launcher.launches).toBe(1);
    expect(thinking).toEqual(["Checking locally. ", "Checking locally. "]);
    expect(responses).toEqual(["Answering locally. ", "Answering locally. "]);
    await expect(client.unload()).resolves.toBe(true);
  });

  it("cancels one multiplexed request without interrupting its sibling", async () => {
    const client = new InferenceWorkerClient(new ScriptLauncher(parallelWorkerScript), "unused");
    const controller = new AbortController();
    const common = {
      modelPath: "/approved/model.gguf",
      memoryBudgetBytes: 1024,
      timeoutMs: residentTimeoutMs,
    };
    const first = client.execute({
      request: generation("first"),
      signal: controller.signal,
      ...common,
    });
    const second = client.execute({ request: generation("second"), ...common });
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    await expect(second).resolves.toMatchObject({ operation: "generate" });
    await expect(client.unload()).resolves.toBe(true);
  });
});

describe("cancelled turn residency", () => {
  it("keeps the resident model loaded when the turn is cancelled during launch", async () => {
    const inner = new ScriptLauncher(residentWorkerScript);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: NativeWorkerLauncher = {
      launch: async (request) => {
        await gate;
        return await inner.launch(request);
      },
    };
    const client = new InferenceWorkerClient(gated, "unused");
    const common = {
      request: largeGeneration,
      modelPath: "/approved/model.gguf",
      memoryBudgetBytes: 1024,
      timeoutMs: 30_000,
    };
    const controller = new AbortController();
    const cancelled = client.execute({ ...common, signal: controller.signal });
    controller.abort(new DOMException("stop", "AbortError"));
    release();
    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });

    await expect(client.execute(common)).resolves.toMatchObject({ operation: "generate" });
    expect(inner.launches).toBe(1);
    await expect(client.unload()).resolves.toBe(true);
  });
});

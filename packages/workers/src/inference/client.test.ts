import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { InferenceWorkerRequestSchema } from "@gardendesk/shared";
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

function execute(script: string, timeoutMs = 500, signal?: AbortSignal, request = probe) {
  return new InferenceWorkerClient(new ScriptLauncher(script), "unused").execute({
    request,
    modelPath: "unused-model",
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one transport case keeps its server and cleanup together.
it("uses private HTTP, reuses the server, and cancels a stream before reuse", async () => {
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\garden-desk-test-${process.pid}`
      : join(tmpdir(), `garden-desk-test-${process.pid}.sock`);
  const server = createServer((req, res) => {
    if (req.url !== "/v1/chat/completions") {
      res.end(req.url === "/slots" ? "[]" : "{}");
      return;
    }
    let body = "";
    req.setEncoding("utf8").on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "private thought" } }] })}\n\n`,
      );
      if (JSON.parse(body).max_tokens === 1) return;
      res.end(
        `data: ${JSON.stringify({ choices: [{ delta: { content: '{"result":"ok"}' }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 4 }, timings: { prompt_n: 10, prompt_ms: 5, predicted_n: 4, predicted_ms: 8 } })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  await new Promise<void>((accept) => server.listen(socket, accept));
  let launches = 0;
  const launcher: NativeWorkerLauncher = {
    async launch() {
      launches++;
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
      });
      setTimeout(() => child.stdout.write("listening on unix://private"), 0);
      return {
        process: child as unknown as NativeWorkerHandle["process"],
        connect: () => createConnection(socket),
        async dispose() {
          child.emit("close", 0);
        },
      };
    },
  };
  const client = new InferenceWorkerClient(launcher, "unused");
  const common = { modelPath: "model.gguf", memoryBudgetBytes: 1024, timeoutMs: 2_000 };
  try {
    const result = await client.execute({ ...common, request: largeGeneration });
    expect(result).toMatchObject({
      operation: "generate",
      value: { result: "ok" },
      performance: { promptTokens: 10, outputTokens: 4 },
    });
    const controller = new AbortController();
    await expect(
      client.execute({
        ...common,
        request: InferenceWorkerRequestSchema.parse({ ...largeGeneration, maxTokens: 1 }),
        signal: controller.signal,
        onThinkingDelta: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    await expect(client.execute({ ...common, request: largeGeneration })).resolves.toMatchObject({
      operation: "generate",
    });
    expect(launches).toBe(1);
  } finally {
    await client.unload();
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

import { EventEmitter } from "node:events";
import { createServer } from "node:http";
// biome-ignore lint/style/noRestrictedImports: this regression uses the private inference transport.
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { InferenceWorkerRequestSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import type { NativeWorkerHandle } from "../native/launcher.js";
import { InferenceWorkerClient } from "./client.js";
import { encodeInferenceResponse, InferenceResponseDecoder } from "./frames.js";
import { InferenceWorkerError } from "./resident-worker.js";
import { inferenceFailureResponse } from "./worker-errors.js";

const privateData =
  'private-worker-stderr-sentinel stderr=/private/worker.log args={"path":"/private/input"} modelOutput=secret stack=private';

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: keep the private server and its cleanup in one regression.
it("keeps a healthy resident server after a generation token limit", async () => {
  const socket =
    process.platform === "win32"
      ? `\\\\.\\pipe\\garden-desk-limit-${process.pid}`
      : join(tmpdir(), `garden-desk-limit-${process.pid}.sock`);
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === "/health") return void res.end("{}");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "{" }, finish_reason: "length" }], usage: { prompt_tokens: 3, completion_tokens: 1 }, timings: { prompt_n: 3, prompt_ms: 1, predicted_n: 1, predicted_ms: 1 } })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((accept) => server.listen(socket, accept));
  const client = new InferenceWorkerClient(
    {
      async launch() {
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
    },
    "unused",
  );
  try {
    await expect(
      client.execute({
        request: InferenceWorkerRequestSchema.parse({
          protocolVersion: 2,
          requestId: "limit",
          jobId: "00000000-0000-4000-8000-000000000001",
          operation: "generate",
          modelId: "test-model",
          prompt: "Respond.",
          jsonSchema: { type: "object" },
          contextSize: 512,
          maxTokens: 1,
        }),
        modelPath: "model.gguf",
        memoryBudgetBytes: 1024,
        timeoutMs: 2000,
      }),
    ).rejects.toThrow("generation_token_limit");
    expect(await client.unload()).toBe(true);
  } finally {
    await client.unload();
    await new Promise<void>((accept) => server.close(() => accept()));
  }
});

describe("inference worker failures", () => {
  it("returns a fixed private error response", () => {
    const response = inferenceFailureResponse(
      new InferenceWorkerError("worker_crash", privateData),
    );
    const frame = encodeInferenceResponse({
      protocolVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      status: "error",
      error: response,
    });
    const [decoded] = new InferenceResponseDecoder().push(frame);

    expect(response).toEqual({ code: "internal", message: "Inference failed." });
    expect(decoded).toEqual({
      protocolVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      status: "error",
      error: response,
    });
    expect(JSON.stringify(decoded)).not.toContain(privateData);
    expect(response).not.toHaveProperty("details");
  });

  it("keeps the checkpoint worker error codes", () => {
    expect(inferenceFailureResponse(new DOMException("stop", "AbortError")).code).toBe("cancelled");
    expect(inferenceFailureResponse(new DOMException("timeout", "TimeoutError")).code).toBe(
      "timeout",
    );
    expect(inferenceFailureResponse(new Error("supported_gpu_required")).code).toBe("unsupported");
    expect(inferenceFailureResponse(new Error("memory allocation failed")).code).toBe(
      "out_of_memory",
    );
  });

  it("keeps an allowlisted unsupported reason for the caller", () => {
    expect(inferenceFailureResponse(new Error("context_size_exceeds_hardware_cap"))).toEqual({
      code: "unsupported",
      message: "context_size_exceeds_hardware_cap",
    });
    expect(inferenceFailureResponse(new Error(`out of memory ${privateData}`))).toEqual({
      code: "out_of_memory",
      message: "Inference failed.",
    });
  });
});

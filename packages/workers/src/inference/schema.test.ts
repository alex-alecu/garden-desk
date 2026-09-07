import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StructuredGenerationRequestSchema } from "@gardendesk/shared";
import { describe, expect, it, vi } from "vitest";
import type { NativeWorkerHandle, NativeWorkerLaunchRequest } from "../native/launcher.js";
import { InferenceWorkerClient } from "./client.js";
import * as serverHttp from "./server-http.js";
import { observeServerMemory } from "./server-memory.js";
import { serverArguments } from "./server-runtime.js";

const request = {
  protocolVersion: 2,
  requestId: "00000000-0000-4000-8000-000000000000",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "generate",
  modelId: "qwen3.8-27b-ud-iq4_xs",
  prompt: "Respond.",
  jsonSchema: { type: "object" },
  maxTokens: 1,
} as const;

describe("generation context contract", () => {
  it("accepts automatic context and the 128K product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: "auto" }).success,
    ).toBe(true);
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 131_072 }).success,
    ).toBe(true);
  });

  it("rejects explicit generation context above the product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 131_073 }).success,
    ).toBe(false);
  });
});

it("uses the Metal buffer name accepted by the pinned server", () => {
  const args = serverArguments({ backend: "metal", modelPath: "model.gguf", contextTokens: 32768 });
  expect(args[args.indexOf("--override-tensor") + 1]).toBe(".*=MTL0");
});

it("uses matching cache types for Metal Flash Attention", () => {
  const args = serverArguments({ backend: "metal", modelPath: "model.gguf", contextTokens: 32768 });
  expect(args[args.indexOf("--cache-type-k") + 1]).toBe(args[args.indexOf("--cache-type-v") + 1]);
});

it("includes target and MTP draft buffers in reported memory", () => {
  const args = serverArguments({ backend: "cuda", modelPath: "model.gguf", contextTokens: 32768 });
  expect(Number(args[args.indexOf("--log-verbosity") + 1])).toBeGreaterThanOrEqual(4);
  const child = Object.assign(new EventEmitter(), { stderr: new PassThrough() });
  const memory = observeServerMemory({ process: child } as unknown as NativeWorkerHandle);
  child.stderr.write(
    [
      "load_tensors: Metal_Mapped model buffer size = 12000.00 MiB",
      "llama_context: constructing llama_context",
      "llama_context: CPU output buffer size = 2.00 MiB",
      "llama_kv_cache: Metal KV buffer size = 256.00 MiB",
      "llama_memory_recurrent: Metal RS buffer size = 128.00 MiB",
      "sched_reserve: Metal compute buffer size = 64.00 MiB",
      "llama_context: constructing llama_context",
      "llama_context: CPU output buffer size = 1.00 MiB",
      "llama_kv_cache: Metal KV buffer size = 8.00 MiB",
      "sched_reserve: Metal compute buffer size = 16.00 MiB",
      "",
    ].join("\n"),
  );
  child.stderr.write("sched_reserve: Metal compute buffer size = 20.00 MiB\n");
  expect(memory()).toEqual({ gpuMemoryBytes: 12476 * 1024 ** 2, cpuRamBytes: 3 * 1024 ** 2 });
  child.emit("close", 0);
});

function fittingLauncher() {
  return {
    gpu: {
      backend: "cuda" as const,
      memoryKind: "dedicated" as const,
      detectedMemoryBytes: 16 * 1024 ** 3,
    },
    launches: [] as NativeWorkerLaunchRequest[],
    cannotFit: false,
    async launch(input: NativeWorkerLaunchRequest) {
      this.launches.push(input);
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      setTimeout(() => {
        child.stderr.write(
          this.cannotFit
            ? "common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user\n"
            : "common_fit_params: successfully fit params to free device memory\n",
        );
        child.stdout.write("listening on unix://private");
      }, 0);
      return {
        process: child as unknown as NativeWorkerHandle["process"],
        async dispose() {
          child.emit("close", 0);
        },
      };
    },
  };
}

function fittingTransport(slot: { n_ctx: number }) {
  return vi
    .spyOn(serverHttp, "serverRequest")
    .mockImplementation(async (_handle, path, _body, options) => {
      if (path === "/slots") return [slot];
      if (path !== "/health")
        options.onEvent?.({
          choices: [{ delta: { content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 4 },
          timings: { prompt_n: 100, prompt_ms: 5, predicted_n: 4, predicted_ms: 8 },
        });
      return {};
    });
}

const fittingRequest = StructuredGenerationRequestSchema.parse({
  ...request,
  contextSize: "auto",
  maxTokens: 16,
});

it("uses the fitted dedicated GPU context and stops when it cannot fit", async () => {
  const slot = { n_ctx: 8192 };
  const transport = fittingTransport(slot);
  const launcher = fittingLauncher();
  const client = new InferenceWorkerClient(launcher, "unused");
  const input = {
    request: fittingRequest,
    modelPath: "model.gguf",
    memoryBudgetBytes: 16 * 1024 ** 3,
    timeoutMs: 2_000,
  };
  try {
    expect(await client.execute(input)).toMatchObject({
      memory: {
        contextSizeTokens: 8192,
        contextLimitTokens: 8192,
        contextLimitReason: "available_dedicated_memory",
      },
    });
    await client.execute(input);
    expect(launcher.launches).toHaveLength(1);
    const args = launcher.launches[0]?.serverArguments ?? [];
    expect(args[args.indexOf("--override-kv") + 1]).toBe("qwen35.context_length=int:65536");
    expect(args[args.indexOf("--fit") + 1]).toBe("on");
    expect(args[args.indexOf("--fit-ctx") + 1]).toBe("8192");
    expect(args[args.indexOf("--spec-type") + 1]).toBe("none");
    expect(args[args.indexOf("--gpu-layers") + 1]).toBe("all");
    expect(args[args.indexOf("--override-tensor") + 1]).toBe(".*=CUDA0");
    await client.unload();
    slot.n_ctx = 49_152;
    launcher.gpu.detectedMemoryBytes = 32 * 1024 ** 3;
    input.memoryBudgetBytes = launcher.gpu.detectedMemoryBytes;
    expect(await client.execute(input)).toMatchObject({
      memory: { contextSizeTokens: 49_152, contextLimitTokens: 49_152 },
    });
    const largerArgs = launcher.launches[1]?.serverArguments ?? [];
    expect(largerArgs[largerArgs.indexOf("--override-kv") + 1]).toBe(
      "qwen35.context_length=int:131072",
    );
    await client.unload();
    launcher.cannotFit = true;
    await expect(client.execute(input)).rejects.toMatchObject({ code: "out_of_memory" });
  } finally {
    await client.unload();
    transport.mockRestore();
  }
});

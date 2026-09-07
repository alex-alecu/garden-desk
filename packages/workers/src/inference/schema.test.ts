import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { StructuredGenerationRequestSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import type { NativeWorkerHandle } from "../native/launcher.js";
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
  it("accepts automatic context and the 32K product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: "auto" }).success,
    ).toBe(true);
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 32_768 }).success,
    ).toBe(true);
  });

  it("rejects explicit generation context above the product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 32_769 }).success,
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

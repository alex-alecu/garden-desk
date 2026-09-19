import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import type { NativeWorkerHandle } from "../native/launcher.js";
import { observeServerMemory } from "./server-memory.js";

it("counts the Metal buffers that the pinned server prints on macOS", async () => {
  const stderr = new PassThrough();
  const memory = observeServerMemory({
    process: Object.assign(new EventEmitter(), { stderr }),
  } as unknown as NativeWorkerHandle);
  await new Promise<void>((accept) => {
    stderr.write(
      "load_tensors: MTL0_Mapped model buffer size = 6861.73 MiB\nllama_kv_cache: MTL0 KV buffer size = 1088.00 MiB\nsched_reserve: MTL0 compute buffer size = 207.76 MiB\nllama_context: CPU output buffer size = 0.95 MiB\n",
      () => accept(),
    );
  });
  expect(memory()).toEqual({
    gpuMemoryBytes:
      Math.round(6861.73 * 1024 ** 2) + 1088 * 1024 ** 2 + Math.round(207.76 * 1024 ** 2),
    cpuRamBytes: Math.round(0.95 * 1024 ** 2),
  });
});

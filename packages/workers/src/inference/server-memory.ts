import type { NativeWorkerHandle } from "../native/launcher.js";

export interface ServerAllocations {
  cpuRamBytes?: number;
  gpuMemoryBytes?: number;
}

function bufferAllocation(line: string, context: number) {
  const match =
    /(?:load_tensors|llama_context|llama_kv_cache|llama_memory_recurrent|graph_reserve|sched_reserve):\s+(\w+)\s+(model|KV|RS|compute|output) buffer size =\s+([\d.]+) MiB/u.exec(
      line,
    );
  if (match === null) return undefined;
  const [, buffer = "", type, size] = match;
  const bytes = Math.round(Number(size) * 1024 ** 2);
  const host = buffer.startsWith("CPU") || buffer.endsWith("_Host");
  if (!host && !/^(?:CUDA\d+|Vulkan\d+|Metal(?:_Mapped)?)$/u.test(buffer)) return undefined;
  if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;
  const kind: keyof ServerAllocations = host ? "cpuRamBytes" : "gpuMemoryBytes";
  return { key: `${type === "model" ? 0 : context}:${buffer}:${type}`, type, kind, bytes };
}

export function observeServerMemory(handle: NativeWorkerHandle): () => ServerAllocations {
  const allocations = new Map<string, { kind: keyof ServerAllocations; bytes: number }>();
  let context = 0;
  let pending = "";
  const output = (chunk: Buffer) => {
    const lines = (pending + chunk.toString()).split("\n");
    pending = (lines.pop() ?? "").slice(-4_096);
    lines.forEach((line) => {
      if (line.includes("llama_context: constructing llama_context")) context += 1;
      const allocation = bufferAllocation(line, context);
      if (allocation === undefined) return;
      const { key, type, kind, bytes } = allocation;
      allocations.set(key, {
        kind,
        bytes: bytes + (type === "model" ? (allocations.get(key)?.bytes ?? 0) : 0),
      });
    });
  };
  handle.process.stderr.on("data", output);
  handle.process.once("close", () => {
    pending = "";
    handle.process.stderr.off("data", output);
  });
  return () => {
    const result: ServerAllocations = {};
    for (const { kind, bytes } of allocations.values()) result[kind] = (result[kind] ?? 0) + bytes;
    return result;
  };
}

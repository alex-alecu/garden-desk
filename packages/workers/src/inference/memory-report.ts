import type { GenerationContextLimitReason } from "@vault/shared";
import type { Llama } from "node-llama-cpp";

interface MemoryReportRuntime {
  backend: "metal" | "cuda" | "vulkan";
  budget: number;
  detectedGpuMemoryBytes: number;
  gpuMemoryKind: "dedicated" | "unified";
  selectedDeviceCount: 1;
  llama: Pick<Llama, "getLlamaMemoryUsage">;
}

export async function memoryReport(
  runtime: MemoryReportRuntime,
  contextSizeTokens: number,
  contextLimit?: { tokens: number; reason: GenerationContextLimitReason; sequenceCount?: number },
) {
  const memory = await runtime.llama.getLlamaMemoryUsage();
  return {
    cpuRamBytes: memory.cpuRam,
    gpuMemoryBytes: memory.gpuVram,
    budgetBytes: runtime.budget,
    detectedGpuMemoryBytes: runtime.detectedGpuMemoryBytes,
    gpuMemoryKind: runtime.gpuMemoryKind,
    backend: runtime.backend,
    selectedDeviceCount: runtime.selectedDeviceCount,
    contextSizeTokens,
    ...(contextLimit === undefined
      ? {}
      : {
          contextLimitTokens: contextLimit.tokens,
          contextLimitReason: contextLimit.reason,
          ...(contextLimit.sequenceCount === undefined
            ? {}
            : { sequenceCount: contextLimit.sequenceCount }),
        }),
  };
}

import type { GenerationContextLimitReason } from "@vault/shared";
import type { Llama } from "node-llama-cpp";

interface MemoryReportRuntime {
  budget: number;
  detectedGpuVramBytes: number;
  llama: Pick<Llama, "getLlamaMemoryUsage">;
}

export async function memoryReport(
  runtime: MemoryReportRuntime,
  contextSizeTokens: number,
  contextLimit?: { tokens: number; reason: GenerationContextLimitReason },
) {
  const memory = await runtime.llama.getLlamaMemoryUsage();
  return {
    cpuRamBytes: memory.cpuRam,
    gpuVramBytes: memory.gpuVram,
    budgetBytes: runtime.budget,
    detectedGpuVramBytes: runtime.detectedGpuVramBytes,
    contextSizeTokens,
    ...(contextLimit === undefined
      ? {}
      : {
          contextLimitTokens: contextLimit.tokens,
          contextLimitReason: contextLimit.reason,
        }),
  };
}

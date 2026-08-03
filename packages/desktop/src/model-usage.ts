import type { GenerationContextLimitReason, ModelRuntimeStatus } from "@vault/shared";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

function formatMemory(bytes: number): string {
  if (bytes === 0) return "0 GiB";
  if (bytes < GIB) return `${Math.round(bytes / MIB)} MiB`;
  return `${(bytes / GIB).toFixed(1)} GiB`;
}

function formatContext(tokens: number): string {
  if (tokens < 1024) return tokens.toLocaleString("en-US");
  return `${Number((tokens / 1024).toFixed(2))}K`;
}

function contextLimitExplanation(reason: GenerationContextLimitReason): string {
  switch (reason) {
    case "mac_unified_memory_at_most_32_gib":
      return "This Mac has 32 GiB unified memory or less; RAM and GPU allocations share that pool.";
    case "mac_unified_memory_above_32_gib":
      return "This Mac has more than 32 GiB unified memory; RAM and GPU allocations share that pool.";
    case "windows_gpu_vram_at_most_24_gib":
      return "This Windows GPU has 24 GiB VRAM or less.";
    case "windows_gpu_vram_above_24_gib":
      return "This Windows GPU has more than 24 GiB VRAM.";
    case "certified_standard":
      return "This platform uses the certified standard context cap.";
  }
}

function optionalMemory(bytes: number | undefined): string | undefined {
  return bytes === undefined ? undefined : formatMemory(bytes);
}

function optionalContext(tokens: number | undefined): string | undefined {
  return tokens === undefined ? undefined : formatContext(tokens);
}

function totalAllocation(model: ModelRuntimeStatus): string | undefined {
  if (model.cpuRamBytes === undefined && model.gpuVramBytes === undefined) return undefined;
  return formatMemory((model.cpuRamBytes ?? 0) + (model.gpuVramBytes ?? 0));
}

function contextExplanation(reason: GenerationContextLimitReason | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return `${contextLimitExplanation(reason)} The runtime allocates the largest context that fits without exceeding this cap.`;
}

export function modelUsage(model: ModelRuntimeStatus) {
  if (model.state !== "ready" && model.state !== "busy") return undefined;
  if (
    model.memoryBudgetBytes === undefined &&
    model.cpuRamBytes === undefined &&
    model.gpuVramBytes === undefined &&
    model.contextSizeTokens === undefined
  )
    return undefined;
  return {
    budget: optionalMemory(model.memoryBudgetBytes),
    totalAllocated: totalAllocation(model),
    ram: optionalMemory(model.cpuRamBytes),
    vram: optionalMemory(model.gpuVramBytes),
    context: optionalContext(model.contextSizeTokens),
    contextLimit: optionalContext(model.contextLimitTokens),
    contextExplanation: contextExplanation(model.contextLimitReason),
  };
}

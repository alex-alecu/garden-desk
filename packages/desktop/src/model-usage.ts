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
    case "unified_memory_at_most_32_gib":
      return "This computer has 32 GiB unified memory or less; RAM and GPU allocations share that pool.";
    case "unified_memory_above_32_gib":
      return "This computer has more than 32 GiB unified memory; RAM and GPU allocations share that pool.";
    case "dedicated_memory_at_most_24_gib":
      return "This GPU has 24 GiB dedicated memory or less.";
    case "dedicated_memory_above_24_gib":
      return "This GPU has more than 24 GiB dedicated memory.";
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
  if (model.cpuRamBytes === undefined && model.gpuMemoryBytes === undefined) return undefined;
  return formatMemory((model.cpuRamBytes ?? 0) + (model.gpuMemoryBytes ?? 0));
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
    model.gpuMemoryBytes === undefined &&
    model.contextSizeTokens === undefined
  )
    return undefined;
  return {
    budget: optionalMemory(model.memoryBudgetBytes),
    totalAllocated: totalAllocation(model),
    ram: optionalMemory(model.cpuRamBytes),
    gpuMemory: optionalMemory(model.gpuMemoryBytes),
    context: optionalContext(model.contextSizeTokens),
    contextLimit: optionalContext(model.contextLimitTokens),
    contextExplanation: contextExplanation(model.contextLimitReason),
  };
}

/** Shows one GPU memory value and the configured budget. Unified memory includes CPU and GPU
 * allocations because both use the same host pool. Dedicated memory shows only the GPU allocation.
 */
export function gpuMemoryUsage(
  model: ModelRuntimeStatus,
):
  | {
      used: string;
      budget: string | undefined;
      label: "VRAM" | "Unified GPU memory";
      sequences: number | undefined;
    }
  | undefined {
  if (model.state !== "ready" && model.state !== "busy") return undefined;
  const used =
    model.gpuMemoryKind === "unified"
      ? totalAllocation(model)
      : optionalMemory(model.gpuMemoryBytes);
  if (used === undefined) return undefined;
  return {
    used,
    budget: optionalMemory(model.memoryBudgetBytes),
    label: model.gpuMemoryKind === "unified" ? "Unified GPU memory" : "VRAM",
    sequences: model.sequenceCount,
  };
}

export function contextMeter(
  usedTokens: number | null,
  allocatedTokens: number | null,
  model: ModelRuntimeStatus,
): { used: number; allocated: number; percent: number; warning: boolean } | undefined {
  const allocated = allocatedTokens ?? model.contextSizeTokens ?? null;
  if (allocated === null || allocated <= 0 || usedTokens === null) return undefined;
  const used = Math.min(usedTokens, allocated);
  const percent = Math.round((used / allocated) * 100);
  return { used, allocated, percent, warning: percent >= 80 };
}

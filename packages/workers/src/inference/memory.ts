import type { GenerationContextLimitReason } from "@vault/shared";

const MINIMUM_GENERATION_CONTEXT = 8_192;
const STANDARD_MAXIMUM_GENERATION_CONTEXT = 65_536;
const HIGH_MEMORY_MAXIMUM_GENERATION_CONTEXT = 131_072;
const CONTEXT_ALIGNMENT = 256;
const GiB = 1024 * 1024 * 1024;
const MAC_HIGH_MEMORY_THRESHOLD_BYTES = 32 * GiB;
const WINDOWS_HIGH_MEMORY_THRESHOLD_BYTES = 24 * GiB;

export interface InferenceAllocation {
  cpuRamBytes: number;
  gpuVramBytes: number;
}

export interface GenerationContextLimit {
  maximumContextTokens: number;
  reason: GenerationContextLimitReason;
}

export function resolveRuntimeMemoryBudget(
  requestedBudgetBytes: number,
  gpuVramBytes: number,
  platform: NodeJS.Platform,
  operation: "generate" | "embed",
): number {
  if (platform !== "win32" || operation !== "generate") return requestedBudgetBytes;
  if (!Number.isSafeInteger(gpuVramBytes) || gpuVramBytes <= 0) {
    throw new Error("supported_gpu_required");
  }
  return gpuVramBytes;
}

export function resolveMaximumGenerationContext(
  platform: NodeJS.Platform,
  totalMemoryBytes: number,
  gpuVramBytes: number,
): number {
  return resolveGenerationContextLimit(platform, totalMemoryBytes, gpuVramBytes)
    .maximumContextTokens;
}

export function resolveGenerationContextLimit(
  platform: NodeJS.Platform,
  totalMemoryBytes: number,
  gpuVramBytes: number,
): GenerationContextLimit {
  if (platform === "darwin") {
    const highMemory = totalMemoryBytes > MAC_HIGH_MEMORY_THRESHOLD_BYTES;
    return {
      maximumContextTokens: highMemory
        ? HIGH_MEMORY_MAXIMUM_GENERATION_CONTEXT
        : STANDARD_MAXIMUM_GENERATION_CONTEXT,
      reason: highMemory ? "mac_unified_memory_above_32_gib" : "mac_unified_memory_at_most_32_gib",
    };
  }
  if (platform === "win32") {
    const highMemory = gpuVramBytes > WINDOWS_HIGH_MEMORY_THRESHOLD_BYTES;
    return {
      maximumContextTokens: highMemory
        ? HIGH_MEMORY_MAXIMUM_GENERATION_CONTEXT
        : STANDARD_MAXIMUM_GENERATION_CONTEXT,
      reason: highMemory ? "windows_gpu_vram_above_24_gib" : "windows_gpu_vram_at_most_24_gib",
    };
  }
  return {
    maximumContextTokens: STANDARD_MAXIMUM_GENERATION_CONTEXT,
    reason: "certified_standard",
  };
}

export function resolveGenerationContextSize(requested: "auto" | number, maximum: number) {
  if (requested !== "auto" && requested > maximum) {
    throw new Error("context_size_exceeds_hardware_cap");
  }
  return requested === "auto" ? { min: MINIMUM_GENERATION_CONTEXT, max: maximum } : requested;
}

export function combinedAllocationBytes(allocation: InferenceAllocation): number {
  return allocation.cpuRamBytes + allocation.gpuVramBytes;
}

export async function fitCombinedGenerationContext(
  budgetBytes: number,
  modelAllocation: InferenceAllocation,
  maximumContextSize: number,
  estimateContext: (contextSize: number) => Promise<InferenceAllocation>,
): Promise<number> {
  let low = MINIMUM_GENERATION_CONTEXT / CONTEXT_ALIGNMENT;
  let high = maximumContextSize / CONTEXT_ALIGNMENT;
  let selected = 0;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const context = await estimateContext(candidate * CONTEXT_ALIGNMENT);
    if (
      combinedAllocationBytes(modelAllocation) + combinedAllocationBytes(context) <=
      budgetBytes
    ) {
      selected = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  if (selected === 0) throw new Error("combined_memory_budget_exceeded");
  return selected * CONTEXT_ALIGNMENT;
}

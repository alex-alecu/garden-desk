import type { GenerationContextLimitReason, GpuMemoryKind } from "@vault/shared";

const MINIMUM_GENERATION_CONTEXT = 8_192;
const STANDARD_MAXIMUM_GENERATION_CONTEXT = 65_536;
const HIGH_MEMORY_MAXIMUM_GENERATION_CONTEXT = 131_072;
const CONTEXT_ALIGNMENT = 256;
const GiB = 1024 * 1024 * 1024;
const UNIFIED_HIGH_MEMORY_THRESHOLD_BYTES = 32 * GiB;
const DEDICATED_HIGH_MEMORY_THRESHOLD_BYTES = 24 * GiB;
const MAXIMUM_EXTRA_SEQUENCES = 2;

export interface InferenceAllocation {
  cpuRamBytes: number;
  gpuMemoryBytes: number;
}

export interface GenerationContextLimit {
  maximumContextTokens: number;
  reason: GenerationContextLimitReason;
}

interface RuntimeMemoryBudgetInput {
  detectedGpuMemoryBytes: number;
  memoryKind: GpuMemoryKind;
  operation: "generate" | "embed";
  platform: NodeJS.Platform;
  requestedBudgetBytes: number;
}

export function resolveRuntimeMemoryBudget(input: RuntimeMemoryBudgetInput): number {
  if (
    input.platform !== "win32" ||
    input.operation !== "generate" ||
    input.memoryKind === "unified"
  ) {
    return input.requestedBudgetBytes;
  }
  if (!Number.isSafeInteger(input.detectedGpuMemoryBytes) || input.detectedGpuMemoryBytes <= 0) {
    throw new Error("supported_gpu_required");
  }
  return input.detectedGpuMemoryBytes;
}

function hardwareContextLimit(
  highMemory: boolean,
  standardReason: GenerationContextLimitReason,
  highMemoryReason: GenerationContextLimitReason,
): GenerationContextLimit {
  return {
    maximumContextTokens: highMemory
      ? HIGH_MEMORY_MAXIMUM_GENERATION_CONTEXT
      : STANDARD_MAXIMUM_GENERATION_CONTEXT,
    reason: highMemory ? highMemoryReason : standardReason,
  };
}

export function resolveMaximumGenerationContext(
  platform: NodeJS.Platform,
  totalMemoryBytes: number,
  gpuMemoryBytes: number,
  memoryKind: GpuMemoryKind = platform === "darwin" ? "unified" : "dedicated",
): number {
  return resolveGenerationContextLimit(platform, totalMemoryBytes, gpuMemoryBytes, memoryKind)
    .maximumContextTokens;
}

export function resolveGenerationContextLimit(
  platform: NodeJS.Platform,
  totalMemoryBytes: number,
  gpuMemoryBytes: number,
  memoryKind: GpuMemoryKind = platform === "darwin" ? "unified" : "dedicated",
): GenerationContextLimit {
  if (memoryKind === "unified") {
    return hardwareContextLimit(
      totalMemoryBytes > UNIFIED_HIGH_MEMORY_THRESHOLD_BYTES,
      "unified_memory_at_most_32_gib",
      "unified_memory_above_32_gib",
    );
  }
  if (platform === "win32") {
    return hardwareContextLimit(
      gpuMemoryBytes > DEDICATED_HIGH_MEMORY_THRESHOLD_BYTES,
      "dedicated_memory_at_most_24_gib",
      "dedicated_memory_above_24_gib",
    );
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
  return allocation.cpuRamBytes + allocation.gpuMemoryBytes;
}

/**
 * Resolves how many parallel generation sequences fit in the memory budget. The primary
 * sequence always keeps its full certified context, so extra sequences are added only while
 * their additional per-sequence KV cache keeps the combined allocation inside the budget,
 * capped at {@link MAXIMUM_EXTRA_SEQUENCES}. Hardware without headroom yields 1, matching the
 * prior single-stream behavior.
 */
export function resolveSequenceCount(
  budgetBytes: number,
  modelAllocationBytes: number,
  perSequenceContextBytes: number,
): number {
  if (perSequenceContextBytes <= 0) return 1;
  const headroom = budgetBytes - modelAllocationBytes - perSequenceContextBytes;
  if (headroom <= 0) return 1;
  const extra = Math.min(MAXIMUM_EXTRA_SEQUENCES, Math.floor(headroom / perSequenceContextBytes));
  return 1 + Math.max(0, extra);
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

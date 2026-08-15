import type {
  GenerationContextLimitReason,
  GpuMemoryKind,
  ModelRuntimeStatus,
  StructuredGenerationResult,
} from "@vault/shared";

export const DEFAULT_MODEL_ID = "gemma-4-12b-it-qat-q4_0";

export interface ModelRuntimeMeasurements {
  memoryBudgetBytes?: number;
  contextSizeTokens?: number;
  cpuRamBytes?: number;
  gpuMemoryBytes?: number;
  gpuMemoryKind?: GpuMemoryKind;
  contextLimitTokens?: number;
  contextLimitReason?: GenerationContextLimitReason;
  sequenceCount?: number;
}

export function generationMeasurements(
  memory: StructuredGenerationResult["memory"],
): ModelRuntimeMeasurements {
  return {
    memoryBudgetBytes: memory.budgetBytes,
    cpuRamBytes: memory.cpuRamBytes,
    gpuMemoryBytes: memory.gpuMemoryBytes,
    gpuMemoryKind: memory.gpuMemoryKind,
    ...(memory.contextSizeTokens === undefined
      ? {}
      : { contextSizeTokens: memory.contextSizeTokens }),
    ...(memory.contextLimitTokens === undefined
      ? {}
      : { contextLimitTokens: memory.contextLimitTokens }),
    ...(memory.contextLimitReason === undefined
      ? {}
      : { contextLimitReason: memory.contextLimitReason }),
    ...(memory.sequenceCount === undefined ? {} : { sequenceCount: memory.sequenceCount }),
  };
}

/**
 * The allocated context is a property of this model on this hardware, so it survives an
 * unload and keeps prompt budgeting correct on the next cold turn. Live allocation and
 * budget belong to the released instance and are dropped.
 */
export function lastKnownContext(measurements: ModelRuntimeMeasurements): ModelRuntimeMeasurements {
  return measurements.contextSizeTokens === undefined
    ? {}
    : {
        contextSizeTokens: measurements.contextSizeTokens,
        ...(measurements.contextLimitTokens === undefined
          ? {}
          : { contextLimitTokens: measurements.contextLimitTokens }),
        ...(measurements.contextLimitReason === undefined
          ? {}
          : { contextLimitReason: measurements.contextLimitReason }),
      };
}

export function modelRuntimeStatus(
  busy: boolean,
  resident: boolean,
  measurements: ModelRuntimeMeasurements,
): ModelRuntimeStatus {
  // Reported usage stays gated on residency, so a retained context never presents an
  // unloaded model as holding memory.
  return {
    modelId: DEFAULT_MODEL_ID,
    name: "Gemma 4 12B QAT",
    state: busy ? "busy" : resident ? "ready" : "unloaded",
    thinkingSupported: true,
    ...measurements,
  };
}

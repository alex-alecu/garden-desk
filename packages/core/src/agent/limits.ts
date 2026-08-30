import type { WorkerLimits } from "@vault/shared";

export const AGENT_MODEL_ID = "gemma-4-12b-it-qat-q4_0";
export const AGENT_PROJECTOR_MODEL_ID = "gemma-4-12b-it-qat-q4_0-mmproj";

export const AGENT_WORKER_LIMITS: WorkerLimits = {
  wallTimeMs: 120_000,
  inputCount: 64,
  inputBytes: 8 * 1024 * 1024 * 1024,
  memoryBytes: 4 * 1024 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  cpuCount: 4,
};

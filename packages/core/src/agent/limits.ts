import type { WorkerLimits } from "@vault/shared";

export const AGENT_WORKER_LIMITS: WorkerLimits = {
  wallTimeMs: 120_000,
  inputCount: 64,
  inputBytes: 8 * 1024 * 1024 * 1024,
  memoryBytes: 4 * 1024 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 16 * 1024 * 1024,
  cpuCount: 4,
};

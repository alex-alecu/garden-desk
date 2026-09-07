import { totalmem } from "node:os";
import { INFERENCE_PROFILE, type InferenceProfile } from "@gardendesk/shared";

const GiB = 1024 * 1024 * 1024;
const AGENT_GUEST_MEMORY_BYTES = 4 * GiB;
const MINIMUM_HOST_RESERVE_BYTES = 4 * GiB;

export type InferenceHardwarePolicy =
  | { supported: true; memoryBudgetBytes: number }
  | { supported: false; message: string };

export function resolveInferenceHardwarePolicy(
  _profile: InferenceProfile,
  platform: NodeJS.Platform = process.platform,
  totalMemoryBytes: number = totalmem(),
): InferenceHardwarePolicy {
  if (platform === "win32") {
    return { supported: true, memoryBudgetBytes: INFERENCE_PROFILE.memoryBudgetBytes };
  }
  if (platform !== "darwin") {
    return { supported: false, message: "This operating system is not supported." };
  }
  if (totalMemoryBytes < INFERENCE_PROFILE.minimumUnifiedMemoryBytes) {
    return {
      supported: false,
      message: "Garden Desk requires a Mac with at least 24 GB of memory.",
    };
  }
  return { supported: true, memoryBudgetBytes: 16 * GiB };
}

export function resolveAgentSessionCapacity(
  inferenceHostMemoryBytes: number,
  totalMemoryBytes: number = totalmem(),
): number {
  const hostReserveBytes = MINIMUM_HOST_RESERVE_BYTES;
  const guestBudgetBytes = totalMemoryBytes - inferenceHostMemoryBytes - hostReserveBytes;
  return Math.max(0, Math.floor(guestBudgetBytes / AGENT_GUEST_MEMORY_BYTES));
}

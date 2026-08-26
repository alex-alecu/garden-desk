import { totalmem } from "node:os";
import type { createVaultCore } from "@vault/core";
import { resolveInferenceHardwarePolicy } from "@vault/core";
import { resolveMaximumGenerationContext } from "@vault/workers";
import { M3ProductCheckFailure } from "./m3-canonical-gate-reporting.js";

type Core = Awaited<ReturnType<typeof createVaultCore>>;

export async function automaticModelEvidence(core: Core) {
  const model = await core.modelStatus();
  const policy = resolveInferenceHardwarePolicy("auto");
  const maximumContextSize = resolveMaximumGenerationContext(process.platform, totalmem(), 0);
  if (
    !policy.supported ||
    model.state !== "ready" ||
    model.memoryBudgetBytes !== policy.memoryBudgetBytes ||
    (model.cpuRamBytes ?? 0) + (model.gpuMemoryBytes ?? 0) > policy.memoryBudgetBytes ||
    (model.contextSizeTokens ?? 0) <= 8_192 ||
    (model.contextSizeTokens ?? 0) > maximumContextSize
  ) {
    throw new M3ProductCheckFailure(
      `Automatic model memory or context proof failed: ${JSON.stringify(model)}`,
    );
  }
  return model;
}

import type { ModelRuntimeStatus } from "@vault/shared";

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

export function modelUsage(model: ModelRuntimeStatus) {
  if (model.state !== "ready" && model.state !== "busy") return undefined;
  if (
    model.memoryBudgetBytes === undefined &&
    model.cpuRamBytes === undefined &&
    model.gpuVramBytes === undefined &&
    model.contextSizeTokens === undefined
  )
    return undefined;
  const allocatedBytes = (model.cpuRamBytes ?? 0) + (model.gpuVramBytes ?? 0);
  return {
    budget:
      model.memoryBudgetBytes === undefined ? undefined : formatMemory(model.memoryBudgetBytes),
    allocated:
      model.cpuRamBytes === undefined && model.gpuVramBytes === undefined
        ? undefined
        : formatMemory(allocatedBytes),
    context:
      model.contextSizeTokens === undefined ? undefined : formatContext(model.contextSizeTokens),
  };
}

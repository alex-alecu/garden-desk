import { INFERENCE_PROFILE } from "@gardendesk/shared";
import type { NativeWorkerHandle, NativeWorkerLauncher } from "../native/launcher.js";
import { contextArguments, readServerContextTokens, waitForServer } from "./server-context.js";
import { unifiedFitMarginMiB } from "./server-device-memory.js";
import { ServerError } from "./server-http.js";
import { observeServerMemory, type ServerAllocations } from "./server-memory.js";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: keep the fixed runtime arguments together.
export function serverArguments(input: {
  backend: "metal" | "cuda" | "vulkan";
  modelPath: string;
  contextTokens: number;
  embedding?: boolean;
  projectorPath?: string;
  fitContext?: boolean;
  fitMarginMiB?: number;
}): string[] {
  const device = { metal: "MTL0", cuda: "CUDA0", vulkan: "Vulkan0" }[input.backend];
  const cacheType = input.embedding ? "f16" : input.backend === "metal" ? "q8_0" : "q4_0";
  return [
    "--model",
    input.modelPath,
    "--offline",
    "--no-ui",
    "--no-ui-mcp-proxy",
    "--no-warmup",
    "--jinja",
    ...contextArguments(input),
    "--gpu-layers",
    "all",
    "--override-tensor",
    `.*=${device}`,
    "--split-mode",
    "none",
    "--main-gpu",
    "0",
    "--flash-attn",
    "on",
    "--parallel",
    "1",
    "--no-context-shift",
    "--slots",
    "--batch-size",
    String(input.embedding ? input.contextTokens : 512),
    "--ubatch-size",
    String(input.embedding ? input.contextTokens : 256),
    "--cache-type-k",
    cacheType,
    "--cache-type-v",
    cacheType,
    "--ctx-checkpoints",
    "2",
    "--checkpoint-min-step",
    "0",
    "--cache-ram",
    "0",
    "--log-verbosity",
    "4",
    "--spec-type",
    "none",
    ...(input.embedding ? ["--embedding", "--pooling", "last"] : []),
    ...(input.projectorPath === undefined
      ? []
      : [
          "--mmproj",
          input.projectorPath,
          "--image-max-tokens",
          String(INFERENCE_PROFILE.imageTokens),
        ]),
  ];
}

export async function startServer(
  launcher: NativeWorkerLauncher,
  entryPath: string,
  input: {
    modelPath: string;
    memoryBudgetBytes: number;
    contextTokens: number;
    embedding?: boolean;
    projectorPath?: string;
  },
  signal: AbortSignal,
): Promise<
  NativeWorkerHandle & {
    contextTokens: number;
    contextFitted: boolean;
    memory(): ServerAllocations;
  }
> {
  const fitContext =
    launcher.gpu?.memoryKind !== undefined && !input.embedding && input.projectorPath === undefined;
  const fitMarginMiB =
    fitContext && launcher.gpu?.memoryKind === "unified"
      ? await unifiedFitMarginMiB(launcher, entryPath, input.memoryBudgetBytes, signal)
      : 512;
  const handle = await launcher.launch({
    workerEntryPath: entryPath,
    memoryBudgetBytes: input.memoryBudgetBytes,
    readPaths: [
      input.modelPath,
      ...(input.projectorPath === undefined ? [] : [input.projectorPath]),
    ],
    serverArguments: serverArguments({
      ...input,
      fitContext,
      fitMarginMiB,
      backend: launcher.gpu?.backend ?? "metal",
    }),
  });
  const memory = observeServerMemory(handle);
  try {
    await waitForServer(handle, fitContext, signal);
    const contextTokens = fitContext
      ? await readServerContextTokens(handle, input.contextTokens, signal)
      : input.contextTokens;
    if (
      fitContext &&
      launcher.gpu?.memoryKind === "unified" &&
      Object.values(memory()).reduce((sum, bytes) => sum + bytes, 0) > input.memoryBudgetBytes
    )
      throw new ServerError("out_of_memory");
    return Object.assign(handle, { memory, contextTokens, contextFitted: fitContext });
  } catch (error) {
    await handle.dispose();
    throw error;
  }
}

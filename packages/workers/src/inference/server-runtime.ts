import { setTimeout as delay } from "node:timers/promises";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import type { NativeWorkerHandle, NativeWorkerLauncher } from "../native/launcher.js";
import { ServerError, serverFailure, serverRequest } from "./server-http.js";
import { observeServerMemory, type ServerAllocations } from "./server-memory.js";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: keep the fixed runtime arguments together.
export function serverArguments(input: {
  backend: "metal" | "cuda" | "vulkan";
  modelPath: string;
  contextTokens: number;
  embedding?: boolean;
  projectorPath?: string;
}): string[] {
  const device = { metal: "Metal", cuda: "CUDA0", vulkan: "Vulkan0" }[input.backend];
  return [
    "--model",
    input.modelPath,
    "--offline",
    "--no-ui",
    "--no-ui-mcp-proxy",
    "--no-warmup",
    "--jinja",
    "--fit",
    "off",
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
    "--ctx-size",
    String(input.contextTokens),
    "--parallel",
    "1",
    "--no-context-shift",
    "--slots",
    "--batch-size",
    String(input.embedding ? input.contextTokens : 512),
    "--ubatch-size",
    String(input.embedding ? input.contextTokens : 256),
    "--cache-type-k",
    input.embedding ? "f16" : input.backend === "metal" ? "q8_0" : "q4_0",
    "--cache-type-v",
    input.embedding || input.backend === "metal" ? "f16" : "q4_0",
    "--ctx-checkpoints",
    "2",
    "--checkpoint-min-step",
    "0",
    "--cache-ram",
    "0",
    "--log-verbosity",
    "3",
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
): Promise<NativeWorkerHandle & { memory(): ServerAllocations }> {
  const handle = await launcher.launch({
    workerEntryPath: entryPath,
    memoryBudgetBytes: input.memoryBudgetBytes,
    readPaths: [
      input.modelPath,
      ...(input.projectorPath === undefined ? [] : [input.projectorPath]),
    ],
    serverArguments: serverArguments({ ...input, backend: launcher.gpu?.backend ?? "metal" }),
  });
  const memory = observeServerMemory(handle);
  let ready = false;
  let stopped = false;
  let failure = new ServerError("worker_crash");
  let pending = "";
  const output = (chunk: Buffer) => {
    pending = (pending + chunk.toString()).slice(-65_536);
    ready ||= pending.includes("listening on unix://");
    failure = serverFailure(pending);
    if (ready) pending = "";
  };
  handle.process.stdout.on("data", output);
  handle.process.stderr.on("data", output);
  handle.process.once("error", () => {
    stopped = true;
  });
  handle.process.once("close", () => {
    stopped = true;
  });
  try {
    while (!ready) {
      signal.throwIfAborted();
      if (stopped) throw failure;
      await delay(25, undefined, { signal });
    }
    await serverRequest(handle, "/health", undefined, { signal });
    return Object.assign(handle, { memory });
  } catch (error) {
    await handle.dispose();
    throw error;
  } finally {
    pending = "";
    handle.process.stdout.off("data", output);
    handle.process.stderr.off("data", output);
    handle.process.stdout.resume();
    handle.process.stderr.resume();
  }
}

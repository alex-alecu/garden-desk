import { setTimeout as delay } from "node:timers/promises";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import type { NativeWorkerHandle, NativeWorkerLauncher } from "../native/launcher.js";
import { ServerError, serverFailure, serverRequest } from "./server-http.js";

export function generationContextTokens(
  requested: number | "auto",
  gpu: NativeWorkerLauncher["gpu"],
): number {
  const maximum =
    gpu?.memoryKind === "dedicated"
      ? (gpu.detectedMemoryBytes ?? 0) > 24 * 1024 ** 3
        ? 131_072
        : 65_536
      : INFERENCE_PROFILE.contextTokens;
  if (requested === "auto") return maximum;
  if (requested > maximum)
    throw new ServerError("invalid_argument", "context_size_exceeds_hardware_cap");
  return requested;
}

export function contextArguments(input: { contextTokens: number; fitContext?: boolean }): string[] {
  if (!input.fitContext) return ["--fit", "off", "--ctx-size", String(input.contextTokens)];
  return [
    "--ctx-size",
    "0",
    "--fit",
    "on",
    "--fit-ctx",
    String(Math.min(input.contextTokens, 8192)),
    "--fit-target",
    "512",
    "--override-kv",
    `qwen35.context_length=int:${input.contextTokens}`,
    "--yarn-orig-ctx",
    "262144",
  ];
}

function contextFitFailed(output: string): boolean {
  return /failed to fit params|encountered an error while trying to fit params|failed to measure the memory of the extra model/u.test(
    output,
  );
}

export async function waitForServer(
  handle: NativeWorkerHandle,
  fitContext: boolean,
  signal: AbortSignal,
): Promise<void> {
  let ready = false;
  let stopped = false;
  let fitFailed = false;
  let failure = new ServerError("worker_crash");
  let pending = "";
  const output = (chunk: Buffer) => {
    pending = (pending + chunk.toString()).slice(-65_536);
    ready ||= pending.includes("listening on unix://");
    fitFailed ||= fitContext && contextFitFailed(pending);
    failure = serverFailure(pending);
    if (ready) pending = "";
  };
  const stop = () => {
    stopped = true;
  };
  handle.process.stdout.on("data", output);
  handle.process.stderr.on("data", output);
  handle.process.once("error", stop);
  handle.process.once("close", stop);
  try {
    while (!ready && !fitFailed) {
      signal.throwIfAborted();
      if (stopped) throw failure;
      await delay(25, undefined, { signal });
    }
    if (fitFailed) throw new ServerError("out_of_memory");
    await serverRequest(handle, "/health", undefined, { signal });
  } finally {
    pending = "";
    handle.process.stdout.off("data", output);
    handle.process.stderr.off("data", output);
    handle.process.stdout.resume();
    handle.process.stderr.resume();
  }
}

export async function readServerContextTokens(
  handle: NativeWorkerHandle,
  maximum: number,
  signal: AbortSignal,
): Promise<number> {
  const slots = (await serverRequest(handle, "/slots", undefined, { signal })) as Array<{
    n_ctx: number;
  }>;
  const contextTokens = slots[0]?.n_ctx;
  if (
    slots.length !== 1 ||
    !Number.isSafeInteger(contextTokens) ||
    contextTokens === undefined ||
    contextTokens < 512 ||
    contextTokens > maximum
  ) {
    throw new ServerError("malformed_worker_message");
  }
  return contextTokens;
}

import { once } from "node:events";
import { freemem } from "node:os";
import type { NativeWorkerLauncher } from "../native/launcher.js";
import { ServerError } from "./server-http.js";

export async function unifiedFitMarginMiB(
  launcher: NativeWorkerLauncher,
  entryPath: string,
  budgetBytes: number,
  signal: AbortSignal,
): Promise<number> {
  const handle = await launcher.launch({
    workerEntryPath: entryPath,
    memoryBudgetBytes: 2 * 1024 ** 3,
    serverArguments: ["--list-devices", "--offline"],
  });
  let output = "";
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-65_536);
  };
  handle.process.stdout.on("data", collect);
  handle.process.stderr.resume();
  try {
    const [code] = await once(handle.process, "close", { signal });
    const devices = [
      ...output.matchAll(/^\s*(?:MTL|CUDA|Vulkan)\d+: .+\((\d+) MiB, (\d+) MiB free\)/gmu),
    ];
    if (code !== 0 || devices.length !== 1) throw new ServerError("worker_crash");
    const freeMiB = Number(devices[0]?.[2]);
    const ramBytes = launcher.gpu?.backend === "metal" ? freemem() : Number.POSITIVE_INFINITY;
    const usableMiB = Math.floor(Math.min(budgetBytes, ramBytes) / 1024 ** 2);
    return Math.max(512, freeMiB - usableMiB + 512);
  } finally {
    handle.process.stdout.off("data", collect);
    await handle.dispose();
  }
}

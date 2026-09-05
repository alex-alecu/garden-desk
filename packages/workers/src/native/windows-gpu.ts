// biome-ignore lint/style/noRestrictedImports: this module launches the bounded GPU fact probes.
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import type { NativeWorkerHandle } from "./launcher.js";
import {
  defaultWindowsInferenceHelperPath,
  type WindowsGpuLaunch,
  WindowsNativeWorkerLauncher,
  windowsHelperEnvironment,
} from "./windows.js";
import { isExpectedWindowsGpuIdentity } from "./windows-gpu-identity.js";
import {
  parseWindowsGpuInfo,
  resolveWindowsGpuProfileFromFacts,
  type WindowsGpuProfile,
  type WindowsRuntimeProbeResult,
} from "./windows-gpu-policy.js";

const GiB = 1024 ** 3;
const PROBE_MEMORY_BYTES = 2 * GiB;
const MAX_OUTPUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 60_000;

export interface ResolveWindowsGpuProfileOptions {
  helperPath?: string;
  runtimePath?: string;
  workerEntryPath: string;
}

interface ResolvedOptions {
  helperPath: string;
  runtimePath: string;
  workerEntryPath: string;
}

function resolvedOptions(input: ResolveWindowsGpuProfileOptions): ResolvedOptions {
  return {
    workerEntryPath: input.workerEntryPath,
    helperPath: resolve(input.helperPath ?? defaultWindowsInferenceHelperPath()),
    runtimePath: resolve(
      input.runtimePath ?? "packages/eval/.generated/inference/windows-cuda-x64/llama-server.exe",
    ),
  };
}

export function collectWindowsGpuProcess(
  child: ReturnType<typeof spawn>,
  errorCode: string,
): Promise<string> {
  return new Promise((accept, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => fail(new Error(`${errorCode}_timeout`)), PROBE_TIMEOUT_MS);
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGKILL");
      reject(error);
    };
    child.stdout?.on("data", (value: Buffer | string) => {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (stdoutBytes + chunk.length > MAX_OUTPUT_BYTES) {
        fail(new Error(`${errorCode}_output_limit`));
        return;
      }
      stdoutBytes += chunk.length;
      stdout.push(chunk);
    });
    child.stderr?.on("data", (value: Buffer | string) => {
      if (stderrBytes >= MAX_OUTPUT_BYTES) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const bounded = chunk.subarray(0, MAX_OUTPUT_BYTES - stderrBytes);
      stderrBytes += bounded.length;
      stderr.push(bounded);
    });
    child.once("error", fail);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) accept(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || errorCode));
    });
  });
}

async function gpuInfo(options: ResolvedOptions) {
  const output = await collectWindowsGpuProcess(
    spawn(options.helperPath, ["gpu-info"], {
      env: windowsHelperEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    "windows_gpu_info_failed",
  );
  return parseWindowsGpuInfo(output);
}

async function collectHandle(handle: NativeWorkerHandle): Promise<string> {
  handle.process.stdin.end();
  try {
    return await collectWindowsGpuProcess(handle.process, "windows_gpu_probe_failed");
  } finally {
    await handle.dispose();
  }
}

async function runtimeProbe(
  options: ResolvedOptions,
  gpu: WindowsGpuLaunch,
): Promise<WindowsRuntimeProbeResult | undefined> {
  const launcher = new WindowsNativeWorkerLauncher(
    options.helperPath,
    windowsServerPath(options.runtimePath, gpu.backend),
    {
      gpu,
    },
  );
  const handle = await launcher.launch({
    workerEntryPath: options.workerEntryPath,
    memoryBudgetBytes: PROBE_MEMORY_BYTES,
    serverArguments: ["--list-devices", "--offline"],
  });
  const output = await collectHandle(handle);
  const devices = [
    ...output.matchAll(/^\s*(?:CUDA|Vulkan)\d+:\s+(.+?)\s+\((\d+)\s+MiB,\s*(\d+)\s+MiB free\)/gmu),
  ];
  if (devices.length === 0) return undefined;
  return {
    schemaVersion: 1,
    backend: gpu.backend,
    deviceNames: devices.map((match) => match[1] as string),
    totalMemoryBytes: Number(devices[0]?.[2]) * 1024 ** 2,
    availableMemoryBytes: Number(devices[0]?.[3]) * 1024 ** 2,
  };
}

export function windowsServerPath(path: string | undefined, backend: "cuda" | "vulkan"): string {
  const base =
    path ?? resolve("packages/eval/.generated/inference/windows-cuda-x64/llama-server.exe");
  return backend === "cuda"
    ? base
    : join(dirname(dirname(base)), "windows-vulkan-x64", "llama-server.exe");
}

export async function resolveWindowsGpuProfile(
  input: ResolveWindowsGpuProfileOptions,
): Promise<WindowsGpuProfile> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("unsupported_windows_gpu_platform");
  }
  const options = resolvedOptions(input);
  const info = await gpuInfo(options);
  const inventories = (
    await Promise.all(
      (["cuda", "vulkan"] as const).map(
        async (backend) => await runtimeProbe(options, { backend }).catch(() => undefined),
      ),
    )
  ).filter((value): value is WindowsRuntimeProbeResult => value !== undefined);
  return await resolveWindowsGpuProfileFromFacts(
    info,
    inventories,
    async (selection) => await runtimeProbe(options, selection),
  );
}

function unsupportedGpu(): never {
  throw Object.assign(new Error("supported_gpu_required"), { code: "unsupported" });
}

async function assertWindowsGpuSelection(
  input: ResolveWindowsGpuProfileOptions,
  profile: WindowsGpuProfile,
  selection: Pick<Required<WindowsGpuLaunch>, "backend" | "deviceIndex" | "expectedName">,
): Promise<void> {
  const options = resolvedOptions(input);
  const info = await gpuInfo(options).catch(() => undefined);
  if (info === undefined) unsupportedGpu();
  const result = await runtimeProbe(options, selection).catch(() => undefined);
  if (!isExpectedWindowsGpuIdentity(profile.adapterId, selection, info, result)) unsupportedGpu();
}

export async function assertWindowsInferenceSelection(
  input: ResolveWindowsGpuProfileOptions,
  profile: WindowsGpuProfile,
): Promise<void> {
  await assertWindowsGpuSelection(input, profile, profile.selection);
}

export async function assertWindowsVisionSelection(
  input: ResolveWindowsGpuProfileOptions,
  profile: WindowsGpuProfile,
): Promise<void> {
  await assertWindowsGpuSelection(input, profile, {
    backend: profile.selection.backend,
    deviceIndex: profile.visionSelection.deviceIndex,
    expectedName: profile.visionSelection.expectedName,
  });
}

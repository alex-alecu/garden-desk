import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "./launcher.js";
import { NativeWorkerLaunchError } from "./launcher.js";

const preparations = new Map<string, Promise<void>>();

export interface WindowsGpuLaunch {
  backend: "cuda" | "vulkan";
  deviceIndex?: number;
  detectedMemoryBytes?: number;
  expectedName?: string;
  installedMemoryBytes?: number;
  memoryKind?: "dedicated" | "unified";
}

export interface WindowsNativeWorkerLauncherOptions {
  gpu?: WindowsGpuLaunch;
}

function validPositiveInteger(value: number | undefined): boolean {
  return value === undefined || (Number.isSafeInteger(value) && value > 0);
}

export function validateWindowsGpuLaunch(gpu: WindowsGpuLaunch): void {
  if (
    (gpu.backend !== "cuda" && gpu.backend !== "vulkan") ||
    (gpu.deviceIndex !== undefined &&
      (!Number.isSafeInteger(gpu.deviceIndex) || gpu.deviceIndex < 0 || gpu.deviceIndex > 0xffff_ffff)) ||
    (gpu.expectedName !== undefined &&
      (gpu.expectedName.length === 0 || gpu.expectedName.length > 512)) ||
    (gpu.memoryKind !== undefined &&
      gpu.memoryKind !== "dedicated" &&
      gpu.memoryKind !== "unified") ||
    !validPositiveInteger(gpu.detectedMemoryBytes) ||
    !validPositiveInteger(gpu.installedMemoryBytes)
  ) {
    throw new Error("invalid_windows_gpu_selection");
  }
}

export function windowsHelperEnvironment(): NodeJS.ProcessEnv {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  return {
    PATH: join(windowsRoot, "System32"),
    SystemRoot: windowsRoot,
    WINDIR: windowsRoot,
  };
}

function runtimeReadPaths(workerEntryPath: string): string[] {
  const workerDirectory = dirname(workerEntryPath);
  return [resolve(workerDirectory, "../..")];
}

export function prepareWindowsRuntime(
  helperPath: string,
  workerEntryPath: string,
): Promise<void> {
  const key = `${helperPath}\0${workerEntryPath}`;
  const existing = preparations.get(key);
  if (existing !== undefined) return existing;
  const pending = new Promise<void>((accept, reject) => {
    const args = ["prepare"];
    for (const path of runtimeReadPaths(workerEntryPath)) args.push("--read", path);
    const child = spawn(helperPath, args, {
      env: windowsHelperEnvironment(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 65_536) stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) accept();
      else reject(new Error(stderr.trim() || `AppContainer preparation exited with ${code}.`));
    });
  });
  preparations.set(key, pending);
  pending.catch(() => preparations.delete(key));
  return pending;
}

export function windowsNativeWorkerArguments(
  request: NativeWorkerLaunchRequest,
  scratch: string,
  runtimePath: string,
  options: WindowsNativeWorkerLauncherOptions = {},
): string[] {
  const args = [
    "run",
    "--executable",
    runtimePath,
    "--worker",
    resolve(request.workerEntryPath),
    "--scratch",
    scratch,
    "--memory",
    String(request.memoryBudgetBytes),
  ];
  if (request.modelPath !== undefined) args.push("--model", resolve(request.modelPath));
  if (options.gpu !== undefined) {
    validateWindowsGpuLaunch(options.gpu);
    args.push("--gpu-backend", options.gpu.backend);
    if (options.gpu.deviceIndex !== undefined) {
      args.push("--gpu-device-index", String(options.gpu.deviceIndex));
    }
    if (options.gpu.expectedName !== undefined) {
      args.push("--expected-gpu-name", options.gpu.expectedName);
    }
    if (options.gpu.memoryKind !== undefined) {
      args.push("--gpu-memory-kind", options.gpu.memoryKind);
    }
    if (options.gpu.detectedMemoryBytes !== undefined) {
      args.push("--detected-gpu-memory", String(options.gpu.detectedMemoryBytes));
    }
    if (options.gpu.installedMemoryBytes !== undefined) {
      args.push("--installed-memory", String(options.gpu.installedMemoryBytes));
    }
  }
  return args;
}

export function defaultWindowsInferenceHelperPath(): string {
  return join(
    process.cwd(),
    "packages/workers/native/windows-appcontainer-launcher/.generated/vault-appcontainer-launcher.exe",
  );
}

export function windowsNativeWorkerEntryPath(): string {
  return join(
    process.cwd(),
    "packages/workers/.generated/windows-runtime/dist/inference/worker.js",
  );
}

export class WindowsNativeWorkerLauncher implements NativeWorkerLauncher {
  constructor(
    private readonly helperPath = defaultWindowsInferenceHelperPath(),
    private readonly runtimePath = process.execPath,
    private readonly options: WindowsNativeWorkerLauncherOptions = {},
  ) {}

  async launch(request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new NativeWorkerLaunchError("unsupported", "unsupported_native_worker_platform");
    }
    await prepareWindowsRuntime(this.helperPath, resolve(request.workerEntryPath));
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vault-inference-"));
    const child = spawn(
      this.helperPath,
      windowsNativeWorkerArguments(request, temporaryRoot, resolve(this.runtimePath), this.options),
      {
        cwd: temporaryRoot,
        env: windowsHelperEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let disposed = false;
    return {
      process: child,
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await new Promise<void>((accept) => {
          if (child.exitCode !== null || child.signalCode !== null) accept();
          else child.once("close", () => accept());
        });
        await rm(temporaryRoot, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100,
        });
      },
    };
  }
}

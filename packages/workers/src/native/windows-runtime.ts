import { LlamaVisionClient } from "../vision/client.js";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "./launcher.js";
import { WindowsNativeWorkerLauncher, windowsNativeWorkerEntryPath } from "./windows.js";
import {
  assertWindowsInferenceSelection,
  type ResolveWindowsGpuProfileOptions,
  resolveWindowsGpuProfile,
  windowsServerPath,
} from "./windows-gpu.js";

export interface NeutralInferenceHardwareProfile {
  memoryBudgetBytes: number;
  hostMemoryReservationBytes: number;
}

interface WindowsInferenceRuntimeOptions {
  inferenceHelperPath?: string;
  inferenceRuntimePath?: string;
  workerEntryPath?: string;
}

class VerifiedWindowsWorkerLauncher implements NativeWorkerLauncher {
  get gpu() {
    return this.launcher.gpu;
  }
  constructor(
    private readonly launcher: NativeWorkerLauncher,
    private readonly verifySelection: () => Promise<void>,
  ) {}

  async launch(request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    await this.verifySelection();
    return await this.launcher.launch(request);
  }
}

function resolverOptions(
  options: WindowsInferenceRuntimeOptions,
  workerEntryPath: string,
): ResolveWindowsGpuProfileOptions {
  return {
    workerEntryPath,
    ...(options.inferenceHelperPath === undefined
      ? {}
      : { helperPath: options.inferenceHelperPath }),
    ...(options.inferenceRuntimePath === undefined
      ? {}
      : { runtimePath: options.inferenceRuntimePath }),
  };
}

export async function createWindowsInferenceRuntime(options: WindowsInferenceRuntimeOptions) {
  const workerEntryPath = options.workerEntryPath ?? windowsNativeWorkerEntryPath();
  const resolver = resolverOptions(options, workerEntryPath);
  const profile = await resolveWindowsGpuProfile(resolver);
  const hardwareProfile: NeutralInferenceHardwareProfile = {
    memoryBudgetBytes: profile.memoryBudgetBytes,
    hostMemoryReservationBytes: profile.hostMemoryReservationBytes,
  };
  const workerLauncher = new VerifiedWindowsWorkerLauncher(
    new WindowsNativeWorkerLauncher(
      options.inferenceHelperPath,
      windowsServerPath(options.inferenceRuntimePath, profile.selection.backend),
      { gpu: profile.selection },
    ),
    async () => await assertWindowsInferenceSelection(resolver, profile),
  );
  return {
    hardwareProfile,
    workerEntryPath,
    workerLauncher,
    visionClient: new LlamaVisionClient(workerLauncher, workerEntryPath),
  };
}

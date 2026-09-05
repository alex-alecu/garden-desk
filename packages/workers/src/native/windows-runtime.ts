import { LlamaVisionClient, type VisionExecution } from "../vision/client.js";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "./launcher.js";
import { WindowsNativeWorkerLauncher, windowsNativeWorkerEntryPath } from "./windows.js";
import {
  assertWindowsInferenceSelection,
  assertWindowsVisionSelection,
  type ResolveWindowsGpuProfileOptions,
  resolveWindowsGpuProfile,
  windowsServerPath,
} from "./windows-gpu.js";
import type { WindowsGpuProfile } from "./windows-gpu-policy.js";

export interface NeutralInferenceHardwareProfile {
  memoryBudgetBytes: number;
  hostMemoryReservationBytes: number;
}

interface WindowsInferenceRuntimeOptions {
  inferenceHelperPath?: string;
  inferenceRuntimePath?: string;
  visionRuntimePath?: string;
  workerEntryPath?: string;
}

export class VerifiedWindowsVisionClient {
  constructor(
    private readonly client: Pick<LlamaVisionClient, "inspect">,
    private readonly verifySelection: () => Promise<void>,
  ) {}

  async inspect(input: VisionExecution): Promise<{ text: string }> {
    await this.verifySelection();
    return await this.client.inspect(input);
  }
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

function visionClient(
  options: WindowsInferenceRuntimeOptions,
  resolver: ResolveWindowsGpuProfileOptions,
  profile: WindowsGpuProfile,
) {
  const client = new LlamaVisionClient(
    new WindowsNativeWorkerLauncher(
      options.inferenceHelperPath,
      windowsServerPath(options.inferenceRuntimePath, profile.selection.backend),
      { gpu: profile.selection },
    ),
    resolver.workerEntryPath,
  );
  return new VerifiedWindowsVisionClient(
    client,
    async () => await assertWindowsVisionSelection(resolver, profile),
  );
}

export async function createWindowsInferenceRuntime(options: WindowsInferenceRuntimeOptions) {
  const workerEntryPath = options.workerEntryPath ?? windowsNativeWorkerEntryPath();
  const resolver = resolverOptions(options, workerEntryPath);
  const profile = await resolveWindowsGpuProfile(resolver);
  const hardwareProfile: NeutralInferenceHardwareProfile = {
    memoryBudgetBytes: profile.memoryBudgetBytes,
    hostMemoryReservationBytes: profile.hostMemoryReservationBytes,
  };
  return {
    hardwareProfile,
    workerEntryPath,
    workerLauncher: new VerifiedWindowsWorkerLauncher(
      new WindowsNativeWorkerLauncher(
        options.inferenceHelperPath,
        windowsServerPath(options.inferenceRuntimePath, profile.selection.backend),
        {
          gpu: profile.selection,
        },
      ),
      async () => await assertWindowsInferenceSelection(resolver, profile),
    ),
    visionClient: visionClient(options, resolver, profile),
  };
}

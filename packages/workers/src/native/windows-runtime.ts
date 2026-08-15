import { LlamaVisionClient, type VisionExecution } from "../vision/client.js";
import {
  assertWindowsVisionSelection,
  resolveWindowsGpuProfile,
  type ResolveWindowsGpuProfileOptions,
} from "./windows-gpu.js";
import type { WindowsGpuProfile } from "./windows-gpu-policy.js";
import {
  WindowsNativeWorkerLauncher,
  windowsNativeWorkerEntryPath,
} from "./windows.js";

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
  if (options.visionRuntimePath === undefined) return undefined;
  const client = new LlamaVisionClient(
    options.visionRuntimePath,
    options.inferenceHelperPath,
    profile.visionSelection.deviceIndex,
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
    workerLauncher: new WindowsNativeWorkerLauncher(
      options.inferenceHelperPath,
      options.inferenceRuntimePath,
      { gpu: profile.selection },
    ),
    visionClient: visionClient(options, resolver, profile),
  };
}

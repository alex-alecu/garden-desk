import { fileURLToPath } from "node:url";
import { type InferenceProfile, InferenceProfileSchema } from "@vault/shared";
import {
  createWindowsInferenceRuntime,
  InferenceWorkerClient,
  LlamaVisionClient,
  MacOsNativeWorkerLauncher,
} from "@vault/workers";
import type { AuditLog } from "../audit/log.js";
import { resolveAgentSessionCapacity, resolveInferenceHardwarePolicy } from "./hardware.js";
import { ModelResolver } from "./models.js";
import { ResourceScheduler } from "./scheduler.js";
import { InferenceSupervisor } from "./supervisor.js";

interface InferenceCompositionOptions {
  modelStoreDir: string;
  profile: InferenceProfile;
  workerEntryPath?: string;
  inferenceHelperPath?: string;
  inferenceRuntimePath?: string;
  visionRuntimePath?: string;
}

export function unavailableInference(message?: string) {
  const unsupported = async (): Promise<never> => {
    throw Object.assign(new Error("inference_not_packaged"), { code: "unsupported" });
  };
  return {
    generate: unsupported,
    chat: unsupported,
    embed: unsupported,
    inspectImage: unsupported,
    async modelStatus() {
      return {
        modelId: "gemma-4-12b-it-qat-q4_0",
        name: "Gemma 4 12B QAT",
        state: message === undefined ? ("unloaded" as const) : ("unsupported" as const),
        thinkingSupported: true,
        ...(message === undefined ? {} : { message }),
      };
    },
    unloadModel: async () => false,
    async close() {},
  };
}

export async function createInferenceService(
  options: InferenceCompositionOptions,
  workspaceRoot: string,
  audit: AuditLog,
) {
  const profile = InferenceProfileSchema.parse(options.profile);
  let windowsRuntime: Awaited<ReturnType<typeof createWindowsInferenceRuntime>> | undefined;
  if (process.platform === "win32") {
    try {
      windowsRuntime = await createWindowsInferenceRuntime({
        ...(options.workerEntryPath === undefined
          ? {}
          : { workerEntryPath: options.workerEntryPath }),
        ...(options.inferenceHelperPath === undefined
          ? {}
          : { inferenceHelperPath: options.inferenceHelperPath }),
        ...(options.inferenceRuntimePath === undefined
          ? {}
          : { inferenceRuntimePath: options.inferenceRuntimePath }),
        ...(options.visionRuntimePath === undefined
          ? {}
          : { visionRuntimePath: options.visionRuntimePath }),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "supported_gpu_required") {
        return {
          service: unavailableInference(
            "This computer does not have a supported local graphics configuration.",
          ),
          available: false,
          agentSessionCapacity: 0,
        } as const;
      }
      throw error;
    }
  }
  const policy = resolveInferenceHardwarePolicy(profile);
  if (!policy.supported && windowsRuntime === undefined) {
    return {
      service: unavailableInference(policy.message),
      available: false,
      agentSessionCapacity: 0,
    } as const;
  }
  const modelResolver = await ModelResolver.open(options.modelStoreDir);
  const hardwareProfile = windowsRuntime?.hardwareProfile ?? {
    memoryBudgetBytes: policy.supported ? policy.memoryBudgetBytes : 0,
    hostMemoryReservationBytes: policy.supported ? policy.memoryBudgetBytes : 0,
  };
  const workerEntryPath =
    windowsRuntime?.workerEntryPath ??
    options.workerEntryPath ??
    fileURLToPath(new URL("../../../workers/dist/inference/worker.js", import.meta.url));
  const launcher =
    windowsRuntime?.workerLauncher ??
    new MacOsNativeWorkerLauncher([workspaceRoot], options.inferenceRuntimePath);
  const vision =
    windowsRuntime?.visionClient ??
    (options.visionRuntimePath === undefined
      ? undefined
      : new LlamaVisionClient(options.visionRuntimePath, options.inferenceHelperPath));
  return {
    service: new InferenceSupervisor(
      new InferenceWorkerClient(launcher, workerEntryPath),
      modelResolver,
      new ResourceScheduler(hardwareProfile.memoryBudgetBytes),
      (event) => audit.append(event),
      vision,
    ),
    available: true,
    agentSessionCapacity: resolveAgentSessionCapacity(
      hardwareProfile.hostMemoryReservationBytes,
    ),
  } as const;
}

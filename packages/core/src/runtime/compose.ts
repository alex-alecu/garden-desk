import { fileURLToPath } from "node:url";
import { type InferenceProfile, InferenceProfileSchema } from "@vault/shared";
import {
  InferenceWorkerClient,
  LlamaVisionClient,
  MacOsNativeWorkerLauncher,
  WindowsNativeWorkerLauncher,
  windowsNativeWorkerEntryPath,
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
  const policy = resolveInferenceHardwarePolicy(InferenceProfileSchema.parse(options.profile));
  if (!policy.supported) {
    return {
      service: unavailableInference(policy.message),
      available: false,
      agentSessionCapacity: 0,
    } as const;
  }
  const modelResolver = await ModelResolver.open(options.modelStoreDir);
  const launcher =
    process.platform === "win32"
      ? new WindowsNativeWorkerLauncher(options.inferenceHelperPath, options.inferenceRuntimePath)
      : new MacOsNativeWorkerLauncher([workspaceRoot], options.inferenceRuntimePath);
  const workerEntryPath =
    options.workerEntryPath ??
    (process.platform === "win32"
      ? windowsNativeWorkerEntryPath()
      : fileURLToPath(new URL("../../../workers/dist/inference/worker.js", import.meta.url)));
  return {
    service: new InferenceSupervisor(
      new InferenceWorkerClient(launcher, workerEntryPath),
      modelResolver,
      new ResourceScheduler(policy.memoryBudgetBytes),
      (event) => audit.append(event),
      options.visionRuntimePath === undefined
        ? undefined
        : new LlamaVisionClient(options.visionRuntimePath, options.inferenceHelperPath),
    ),
    available: true,
    agentSessionCapacity: resolveAgentSessionCapacity(policy.memoryBudgetBytes),
  } as const;
}

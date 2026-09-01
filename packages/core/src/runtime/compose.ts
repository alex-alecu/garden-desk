import { fileURLToPath } from "node:url";
import { type InferenceProfile, InferenceProfileSchema } from "@gardendesk/shared";
import {
  createWindowsInferenceRuntime,
  InferenceWorkerClient,
  LlamaVisionClient,
  MacOsNativeWorkerLauncher,
} from "@gardendesk/workers";
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

type WindowsRuntime = Awaited<ReturnType<typeof createWindowsInferenceRuntime>>;

function unavailableResult(message: string) {
  return {
    service: unavailableInference(message),
    available: false,
    agentSessionCapacity: 0,
  } as const;
}

function windowsRuntimeOptions(options: InferenceCompositionOptions) {
  const configured: Parameters<typeof createWindowsInferenceRuntime>[0] = {};
  if (options.workerEntryPath !== undefined) configured.workerEntryPath = options.workerEntryPath;
  if (options.inferenceHelperPath !== undefined) {
    configured.inferenceHelperPath = options.inferenceHelperPath;
  }
  if (options.inferenceRuntimePath !== undefined) {
    configured.inferenceRuntimePath = options.inferenceRuntimePath;
  }
  if (options.visionRuntimePath !== undefined)
    configured.visionRuntimePath = options.visionRuntimePath;
  return configured;
}

async function windowsRuntime(
  options: InferenceCompositionOptions,
): Promise<WindowsRuntime | undefined> {
  if (process.platform !== "win32") return undefined;
  return await createWindowsInferenceRuntime(windowsRuntimeOptions(options));
}

function windowsRuntimeFailure(error: unknown): ReturnType<typeof unavailableResult> {
  if (error instanceof Error && error.message === "supported_gpu_required") {
    return unavailableResult(
      "This computer does not have a supported local graphics configuration.",
    );
  }
  throw error;
}

function hardwareProfile(
  selected: WindowsRuntime | undefined,
  policy: ReturnType<typeof resolveInferenceHardwarePolicy>,
) {
  if (selected !== undefined) return selected.hardwareProfile;
  if (!policy.supported) throw new Error("unsupported_inference_hardware");
  return {
    memoryBudgetBytes: policy.memoryBudgetBytes,
    hostMemoryReservationBytes: policy.memoryBudgetBytes,
  };
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
  let selectedWindowsRuntime: WindowsRuntime | undefined;
  try {
    selectedWindowsRuntime = await windowsRuntime(options);
  } catch (error) {
    return windowsRuntimeFailure(error);
  }
  const policy = resolveInferenceHardwarePolicy(profile);
  if (!policy.supported && selectedWindowsRuntime === undefined)
    return unavailableResult(policy.message);
  const modelResolver = await ModelResolver.open(options.modelStoreDir);
  const selectedHardware = hardwareProfile(selectedWindowsRuntime, policy);
  const workerEntryPath =
    selectedWindowsRuntime?.workerEntryPath ??
    options.workerEntryPath ??
    fileURLToPath(new URL("../../../workers/dist/inference/worker.js", import.meta.url));
  const launcher =
    selectedWindowsRuntime?.workerLauncher ??
    new MacOsNativeWorkerLauncher([workspaceRoot], options.inferenceRuntimePath);
  const vision =
    selectedWindowsRuntime?.visionClient ??
    (options.visionRuntimePath === undefined
      ? undefined
      : new LlamaVisionClient(options.visionRuntimePath, options.inferenceHelperPath));
  return {
    service: new InferenceSupervisor(
      new InferenceWorkerClient(launcher, workerEntryPath),
      modelResolver,
      new ResourceScheduler(selectedHardware.memoryBudgetBytes),
      (event) => audit.append(event),
      vision,
    ),
    available: true,
    agentSessionCapacity: resolveAgentSessionCapacity(selectedHardware.hostMemoryReservationBytes),
  } as const;
}

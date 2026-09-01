import { totalmem } from "node:os";
import type { GpuMemoryKind, InferenceBackend } from "@gardendesk/shared";
import type { Llama, LlamaGpuType, LlamaModel } from "node-llama-cpp";
import { resolveRuntimeMemoryBudget } from "./memory.js";
import { loadLlamaRuntime } from "./runtime-loader.js";

export interface SelectedRuntime {
  budget: number;
  backend: InferenceBackend;
  detectedGpuMemoryBytes: number;
  gpuMemoryKind: GpuMemoryKind;
  installedMemoryBytes: number;
  selectedDeviceCount: 1;
  llama: Llama;
  model: LlamaModel;
}

interface WorkerRuntimeArguments {
  backend?: LlamaGpuType;
  expectedDeviceName?: string;
  expectedMemoryBytes?: number;
  gpuMemoryKind: GpuMemoryKind;
  installedMemoryBytes: number;
  modelPath: string;
  requestedBudget: number;
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index === -1 || value === undefined) throw new Error(`Missing ${name}.`);
  return value;
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function windowsRuntimeArguments(
  modelPath: string,
  requestedBudget: number,
): WorkerRuntimeArguments {
  const backend = argument("--gpu-backend") as LlamaGpuType;
  const expectedDeviceName = argument("--expected-gpu-name");
  const gpuMemoryKind = argument("--gpu-memory-kind") as GpuMemoryKind;
  const installedMemoryBytes = Number(argument("--installed-memory"));
  const expectedMemoryBytes = Number(argument("--detected-gpu-memory"));
  if (
    (backend !== "cuda" && backend !== "vulkan") ||
    (gpuMemoryKind !== "dedicated" && gpuMemoryKind !== "unified") ||
    !validPositiveInteger(installedMemoryBytes) ||
    !validPositiveInteger(expectedMemoryBytes)
  ) {
    throw new Error("Invalid worker GPU arguments.");
  }
  return {
    backend,
    expectedDeviceName,
    expectedMemoryBytes,
    gpuMemoryKind,
    installedMemoryBytes,
    modelPath,
    requestedBudget,
  };
}

export function workerRuntimeArguments(): WorkerRuntimeArguments {
  const modelPath = argument("--model");
  const requestedBudget = Number(argument("--memory-budget"));
  if (!validPositiveInteger(requestedBudget)) throw new Error("Invalid worker launch arguments.");
  if (process.platform === "win32") return windowsRuntimeArguments(modelPath, requestedBudget);
  return {
    gpuMemoryKind: "unified",
    installedMemoryBytes: totalmem(),
    modelPath,
    requestedBudget,
  };
}

function llamaRuntimeOptions(input: WorkerRuntimeArguments) {
  const options: { backend?: LlamaGpuType; expectedDeviceName?: string } = {};
  if (input.backend !== undefined) options.backend = input.backend;
  if (input.expectedDeviceName !== undefined) options.expectedDeviceName = input.expectedDeviceName;
  return options;
}

export async function loadSelectedRuntime(
  operation: "generate" | "embed",
): Promise<SelectedRuntime> {
  const input = workerRuntimeArguments();
  const loaded = await loadLlamaRuntime(llamaRuntimeOptions(input));
  if (
    input.expectedMemoryBytes !== undefined &&
    loaded.detectedGpuMemoryBytes !== input.expectedMemoryBytes
  ) {
    await loaded.llama.dispose();
    throw new Error("selected_gpu_changed");
  }
  const budget = resolveRuntimeMemoryBudget({
    requestedBudgetBytes: input.requestedBudget,
    detectedGpuMemoryBytes: loaded.detectedGpuMemoryBytes,
    platform: process.platform,
    operation,
    memoryKind: input.gpuMemoryKind,
  });
  await loaded.llama.setVramCap(budget);
  return {
    budget,
    backend: loaded.backend === false ? "metal" : loaded.backend,
    detectedGpuMemoryBytes: loaded.detectedGpuMemoryBytes,
    gpuMemoryKind: input.gpuMemoryKind,
    installedMemoryBytes: input.installedMemoryBytes,
    selectedDeviceCount: 1,
    llama: loaded.llama,
    model: await loaded.llama.loadModel({ modelPath: input.modelPath }),
  };
}

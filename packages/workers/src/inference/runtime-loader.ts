import type { Llama, LlamaGpuType } from "node-llama-cpp";

export const windowsGpuOrder: readonly LlamaGpuType[] = ["cuda", "vulkan"];

async function tryWindowsGpu(gpu: LlamaGpuType): Promise<Llama | undefined> {
  try {
    const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
    const llama = await getLlama({
      gpu,
      build: "never",
      skipDownload: true,
      logLevel: LlamaLogLevel.error,
    });
    if (llama.gpu === gpu) return llama;
    await llama.dispose();
  } catch {
    // Try the next packaged backend.
  }
  return undefined;
}

async function runtimeWithGpuMemory(llama: Llama, expectedDeviceName?: string) {
  try {
    const [vram, gpuDeviceNames] = await Promise.all([
      llama.getVramState(),
      llama.getGpuDeviceNames(),
    ]);
    if (process.platform === "win32") {
      if (gpuDeviceNames.length !== 1) throw new Error("selected_gpu_isolation_failed");
      if (expectedDeviceName !== undefined && gpuDeviceNames[0] !== expectedDeviceName) {
        throw new Error("selected_gpu_changed");
      }
    }
    if (!Number.isSafeInteger(vram.total) || vram.total <= 0) {
      throw new Error("supported_gpu_required");
    }
    return {
      llama,
      backend: llama.gpu,
      detectedGpuMemoryBytes: vram.total,
      deviceNames: gpuDeviceNames,
    };
  } catch (error) {
    await llama.dispose();
    throw error;
  }
}

export async function inspectLlamaBackend(gpu: LlamaGpuType) {
  const llama = await tryWindowsGpu(gpu);
  if (llama === undefined) throw new Error("supported_gpu_required");
  try {
    const [vram, deviceNames] = await Promise.all([
      llama.getVramState(),
      llama.getGpuDeviceNames(),
    ]);
    return { backend: gpu, deviceNames, vram };
  } finally {
    await llama.dispose();
  }
}

export async function loadLlamaRuntime(options: {
  backend?: LlamaGpuType;
  expectedDeviceName?: string;
} = {}) {
  if (process.platform === "win32") {
    if (options.backend !== "cuda" && options.backend !== "vulkan") {
      throw new Error("selected_gpu_backend_required");
    }
    const llama = await tryWindowsGpu(options.backend);
    if (llama === undefined) throw new Error("supported_gpu_required");
    return await runtimeWithGpuMemory(llama, options.expectedDeviceName);
  }
  const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
  return await runtimeWithGpuMemory(await getLlama({ logLevel: LlamaLogLevel.error }));
}

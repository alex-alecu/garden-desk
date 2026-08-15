import type { Llama, LlamaGpuType } from "node-llama-cpp";
import { resolveDetectedGpuVramBytes } from "./memory.js";

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

async function runtimeWithGpuMemory(llama: Llama, developmentAllowWindowsSharedGpu: boolean) {
  try {
    const [vram, gpuDeviceNames] = await Promise.all([
      llama.getVramState(),
      llama.getGpuDeviceNames(),
    ]);
    return {
      llama,
      detectedGpuVramBytes: resolveDetectedGpuVramBytes(
        process.platform,
        vram,
        gpuDeviceNames.length,
        developmentAllowWindowsSharedGpu,
      ),
      sharedGpuMemory: process.platform === "win32" && vram.unifiedSize !== 0,
    };
  } catch (error) {
    await llama.dispose();
    throw error;
  }
}

export async function loadLlamaRuntime(developmentAllowWindowsSharedGpu = false) {
  if (process.platform === "win32") {
    for (const gpu of windowsGpuOrder) {
      const llama = await tryWindowsGpu(gpu);
      if (llama !== undefined) {
        return await runtimeWithGpuMemory(llama, developmentAllowWindowsSharedGpu);
      }
    }
    throw new Error("supported_gpu_required");
  }
  const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
  return await runtimeWithGpuMemory(await getLlama({ logLevel: LlamaLogLevel.error }), false);
}

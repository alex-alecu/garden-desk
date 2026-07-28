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

export async function loadLlamaRuntime(): Promise<Llama> {
  if (process.platform === "win32") {
    for (const gpu of windowsGpuOrder) {
      const llama = await tryWindowsGpu(gpu);
      if (llama !== undefined) return llama;
    }
    throw new Error("supported_gpu_required");
  }
  const { getLlama, LlamaLogLevel } = await import("node-llama-cpp");
  return await getLlama({ logLevel: LlamaLogLevel.error });
}

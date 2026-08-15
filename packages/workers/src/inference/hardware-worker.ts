import type { LlamaGpuType } from "node-llama-cpp";
import { inspectLlamaBackend } from "./runtime-loader.js";

function backendArgument(): LlamaGpuType {
  const index = process.argv.indexOf("--gpu-backend");
  const value = process.argv[index + 1];
  if (value !== "cuda" && value !== "vulkan") {
    throw new Error("gpu_probe_backend_required");
  }
  return value;
}

try {
  const result = await inspectLlamaBackend(backendArgument());
  process.stdout.write(
    JSON.stringify({
      schemaVersion: 1,
      backend: result.backend,
      deviceNames: result.deviceNames,
      totalMemoryBytes: result.vram.total,
    }),
  );
} catch {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, available: false }));
}

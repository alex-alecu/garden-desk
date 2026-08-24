import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { createVaultCore } from "@vault/core";
import { resolveMaximumGenerationContext } from "@vault/workers";
import { generationModelId, prepareAgentModelStore } from "./agent-model-store.js";
import { developmentWindowsInferencePaths } from "./windows-inference.js";

const modelId = generationModelId;
const modelRoot = join(process.cwd(), "packages/eval/.generated/models");
const GiB = 1024 * 1024 * 1024;

async function generate(workspaceDir: string) {
  const inference = await developmentWindowsInferencePaths();
  const core = await createVaultCore({
    workspaceDir,
    modelStoreDir: modelRoot,
    profile: "auto",
    ...inference,
  });
  try {
    return await core.generate({
      modelId,
      prompt: 'Return a JSON object whose only field is "status" and value is "ok".',
      jsonSchema: {
        type: "object",
        properties: { status: { const: "ok" } },
        required: ["status"],
        additionalProperties: false,
      },
      contextSize: "auto",
      maxTokens: 32,
    });
  } finally {
    await core.close();
  }
}

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The M3 Windows memory gate requires Windows x64.");
}
await prepareAgentModelStore(modelRoot);
const workspaceDir = await mkdtemp(join(tmpdir(), "vault-m3-windows-memory-"));
try {
  const result = await generate(workspaceDir);
  const memory = result.memory;
  const maximumContextSize = resolveMaximumGenerationContext(
    process.platform,
    totalmem(),
    memory.detectedGpuMemoryBytes,
    memory.gpuMemoryKind,
  );
  if (
    memory.gpuMemoryKind !== "dedicated" ||
    memory.backend !== "cuda" ||
    memory.selectedDeviceCount !== 1 ||
    memory.contextSizeTokens !== 65_536 ||
    memory.contextLimitTokens !== 65_536 ||
    memory.contextLimitReason !== "dedicated_memory_at_most_24_gib" ||
    maximumContextSize !== 65_536 ||
    memory.detectedGpuMemoryBytes > 24 * GiB ||
    memory.budgetBytes !== memory.detectedGpuMemoryBytes ||
    memory.gpuMemoryBytes > memory.budgetBytes
  ) {
    throw new Error(`Windows GPU memory or context proof failed: ${JSON.stringify(memory)}`);
  }
  const report = {
    schemaVersion: 1,
    platform: process.platform,
    architecture: process.arch,
    totalMemoryBytes: totalmem(),
    runtimeBuild: "node-llama-cpp@3.19.0",
    value: result.value,
    memory,
    cleanShutdown: true,
  };
  const reportRoot = join(process.cwd(), "packages/eval/.generated/reports");
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, "m3-windows-memory.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await rm(workspaceDir, { recursive: true, force: true });
}

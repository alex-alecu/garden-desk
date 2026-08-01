import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { basename, join } from "node:path";
import { createVaultCore } from "@vault/core";
import { resolveMaximumGenerationContext } from "@vault/workers";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

const modelId = "gemma-4-12b-it-qat-q4_0";
const modelRoot = join(process.cwd(), "packages/eval/.generated/models");
const modelPath = join(modelRoot, `${modelId}.gguf`);

async function prepareModelStore(): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const model = manifest.models.find((candidate) => candidate.id === modelId);
  if (model === undefined) throw new Error(`Canonical model missing: ${modelId}`);
  await verifyModelFile(model, modelPath);
  await writeFile(
    join(modelRoot, "installed-models.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        models: [
          {
            modelId,
            sha256: model.sha256,
            byteLength: model.byteLength,
            runtimeBuild: "node-llama-cpp@3.19.0",
            storeKey: basename(modelPath),
            installedAt: new Date().toISOString(),
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function generate(workspaceDir: string) {
  const core = await createVaultCore({ workspaceDir, modelStoreDir: modelRoot, profile: "auto" });
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
await prepareModelStore();
const workspaceDir = await mkdtemp(join(tmpdir(), "vault-m3-windows-memory-"));
try {
  const result = await generate(workspaceDir);
  const memory = result.memory;
  const maximumContextSize = resolveMaximumGenerationContext(
    process.platform,
    totalmem(),
    memory.detectedGpuVramBytes,
  );
  if (
    (memory.contextSizeTokens ?? 0) <= 8_192 ||
    (memory.contextSizeTokens ?? 0) > maximumContextSize ||
    memory.budgetBytes !== memory.detectedGpuVramBytes ||
    memory.gpuVramBytes > memory.budgetBytes
  ) {
    throw new Error(`Windows automatic VRAM or context proof failed: ${JSON.stringify(memory)}`);
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

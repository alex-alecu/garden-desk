import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { basename, join } from "node:path";
import { createVaultCore } from "@vault/core";
import type { EmbeddingResult, InferenceProfile } from "@vault/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

const modelRoot = join(process.cwd(), "packages/eval/.generated/models");
const modelFiles = new Map([
  ["qwen3-embedding-0.6b-q8_0", join(modelRoot, "qwen3-embedding-0.6b-q8_0.gguf")],
  ["gemma-4-e2b-it-qat-q4_0", join(modelRoot, "gemma-4-e2b-it-qat-q4_0.gguf")],
  ["gemma-4-12b-it-qat-q4_0", join(modelRoot, "gemma-4-12b-it-qat-q4_0.gguf")],
]);

async function prepareModelStore(): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const installed = [];
  for (const [modelId, path] of modelFiles) {
    const asset = manifest.models.find((candidate) => candidate.id === modelId);
    if (asset === undefined) throw new Error(`Canonical model missing: ${modelId}`);
    await verifyModelFile(asset, path);
    installed.push({
      modelId,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      runtimeBuild: "node-llama-cpp@3.19.0",
      storeKey: basename(path),
      installedAt: new Date().toISOString(),
    });
  }
  await writeFile(
    join(modelRoot, "installed-models.json"),
    JSON.stringify({ schemaVersion: 1, models: installed }, null, 2),
  );
}

async function generate(profile: InferenceProfile, modelId: string) {
  const workspaceDir = await mkdtemp(join(tmpdir(), `vault-m2-${profile}-`));
  try {
    const core = await createVaultCore({ workspaceDir, modelStoreDir: modelRoot, profile });
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
        contextSize: 2048,
        maxTokens: 32,
      });
    } finally {
      await core.close();
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
}

await prepareModelStore();
console.log("M2 macOS: running Qwen3 embedding canary.");
const workspaceDir = await mkdtemp(join(tmpdir(), "vault-m2-embedding-"));
let embedding: EmbeddingResult;
try {
  const core = await createVaultCore({
    workspaceDir,
    modelStoreDir: modelRoot,
    profile: "local12",
  });
  try {
    embedding = await core.embed({
      modelId: "qwen3-embedding-0.6b-q8_0",
      input: "Garden Desk offline retrieval smoke",
      contextSize: 512,
    });
  } finally {
    await core.close();
  }
} finally {
  await rm(workspaceDir, { recursive: true, force: true });
}

console.log("M2 macOS: running Gemma 4 E2B Local 12 canary.");
const e2b = await generate("local12", "gemma-4-e2b-it-qat-q4_0");
console.log("M2 macOS: running Gemma 4 12B Local 12 canary.");
const local12 = await generate("local12", "gemma-4-12b-it-qat-q4_0");
console.log("M2 macOS: running Gemma 4 12B Local 16 canary.");
const local16 = await generate("local16", "gemma-4-12b-it-qat-q4_0");
const report = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  totalMemoryBytes: totalmem(),
  runtimeBuild: "node-llama-cpp@3.19.0",
  embedding: { dimensions: embedding.vector.length, memory: embedding.memory },
  e2b: { value: e2b.value, memory: e2b.memory },
  local12: { value: local12.value, memory: local12.memory },
  local16: { value: local16.value, memory: local16.memory },
  cleanShutdown: true,
};
await mkdir(join(process.cwd(), "packages/eval/.generated/reports"), { recursive: true });
await writeFile(
  join(process.cwd(), "packages/eval/.generated/reports/m2-macos.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));

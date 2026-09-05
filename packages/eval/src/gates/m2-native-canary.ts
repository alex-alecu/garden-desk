import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, totalmem } from "node:os";
import { basename, join } from "node:path";
import { createGardenDeskCore } from "@gardendesk/core";
import type { EmbeddingResult, InferenceProfile } from "@gardendesk/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

const modelRoot = join(process.cwd(), "packages/eval/.generated/models");
const modelFiles = new Map([
  ["qwen3-embedding-0.6b-q8_0", join(modelRoot, "qwen3-embedding-0.6b-q8_0.gguf")],
  ["qwen3.8-27b-ud-iq4_xs", join(modelRoot, "qwen3.8-27b-ud-iq4_xs.gguf")],
]);

function platformName(): string {
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new Error("M2 native canaries require macOS or Windows.");
}

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
      runtimeBuild: "llama.cpp@b10816",
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
  const workspaceDir = await mkdtemp(join(tmpdir(), `garden-desk-m2-${profile}-`));
  try {
    const core = await createGardenDeskCore({ workspaceDir, modelStoreDir: modelRoot, profile });
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

const platform = platformName();
await prepareModelStore();
console.log(`M2 ${platform}: running Qwen3 embedding canary.`);
const workspaceDir = await mkdtemp(join(tmpdir(), "garden-desk-m2-embedding-"));
let embedding: EmbeddingResult;
try {
  const core = await createGardenDeskCore({
    workspaceDir,
    modelStoreDir: modelRoot,
    profile: "local16",
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

const local16 = await generate("local16", "qwen3.8-27b-ud-iq4_xs");
const report = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  totalMemoryBytes: totalmem(),
  runtimeBuild: "llama.cpp@b10816",
  embedding: { dimensions: embedding.vector.length, memory: embedding.memory },
  local16: { value: local16.value, memory: local16.memory },
  cleanShutdown: true,
};
await mkdir(join(process.cwd(), "packages/eval/.generated/reports"), { recursive: true });
await writeFile(
  join(process.cwd(), `packages/eval/.generated/reports/m2-${platform}.json`),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));

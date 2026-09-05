import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

export const generationModelId = "qwen3.8-27b-ud-iq4_xs";
export const projectorModelId = "qwen3.8-27b-mmproj-f16";

export async function prepareAgentModelStore(modelRoot: string): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const requested = [
    { id: generationModelId, runtimeBuild: "llama.cpp@b10816" },
    { id: projectorModelId, runtimeBuild: "llama.cpp@b10816" },
  ] as const;
  const installed = await Promise.all(
    requested.map(async (request) => {
      const model = manifest.models.find((candidate) => candidate.id === request.id);
      if (model === undefined) throw new Error(`Canonical model is missing: ${request.id}`);
      const path = join(modelRoot, `${model.id}.gguf`);
      await verifyModelFile(model, path);
      return {
        modelId: model.id,
        sha256: model.sha256,
        byteLength: model.byteLength,
        runtimeBuild: request.runtimeBuild,
        storeKey: `${model.id}.gguf`,
        installedAt: new Date().toISOString(),
      };
    }),
  );
  await writeFile(
    join(modelRoot, "installed-models.json"),
    JSON.stringify({ schemaVersion: 1, models: installed }),
  );
}

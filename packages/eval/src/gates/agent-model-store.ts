import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

export const generationModelId = "gemma-4-12b-it-qat-q4_0";
export const projectorModelId = "gemma-4-12b-it-qat-q4_0-mmproj";

export async function prepareAgentModelStore(modelRoot: string): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const requested = [
    { id: generationModelId, runtimeBuild: "node-llama-cpp@3.19.0" },
    { id: projectorModelId, runtimeBuild: "llama.cpp@b9842" },
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

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INFERENCE_PROFILE } from "@gardendesk/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";

export const generationModelId = INFERENCE_PROFILE.modelId;
export const projectorModelId = INFERENCE_PROFILE.projectorId;

export async function prepareAgentModelStore(modelRoot: string): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const requested = [
    { id: generationModelId, runtimeBuild: INFERENCE_PROFILE.runtimeBuild },
    { id: projectorModelId, runtimeBuild: INFERENCE_PROFILE.runtimeBuild },
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

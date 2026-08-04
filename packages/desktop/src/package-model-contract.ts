import { join } from "node:path";

export const generationModelId = "gemma-4-12b-it-qat-q4_0";
export const generationModelFileName = `${generationModelId}.gguf`;
export const generationModelResourcePath = `models/${generationModelFileName}`;

export function canonicalGenerationModelPath(repositoryRoot: string): string {
  return join(repositoryRoot, "packages", "eval", ".generated", "models", generationModelFileName);
}

export function packagedGenerationModelPath(resourcesRoot: string): string {
  return join(resourcesRoot, "models", generationModelFileName);
}

export function generationModelPackageFile(repositoryRoot: string): {
  source: string;
  path: string;
} {
  return {
    source: canonicalGenerationModelPath(repositoryRoot),
    path: generationModelResourcePath,
  };
}

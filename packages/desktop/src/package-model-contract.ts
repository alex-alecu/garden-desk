import { join } from "node:path";

export const generationModelId = "gemma-4-12b-it-qat-q4_0";
export const generationModelFileName = `${generationModelId}.gguf`;
export const generationModelResourcePath = `models/${generationModelFileName}`;
export const projectorModelId = "gemma-4-12b-it-qat-q4_0-mmproj";
export const projectorModelFileName = `${projectorModelId}.gguf`;
export const projectorModelResourcePath = `models/${projectorModelFileName}`;
export const packagedModelFiles = [
  {
    id: generationModelId,
    fileName: generationModelFileName,
    resourcePath: generationModelResourcePath,
  },
  {
    id: projectorModelId,
    fileName: projectorModelFileName,
    resourcePath: projectorModelResourcePath,
  },
] as const;

export function canonicalModelPath(repositoryRoot: string, fileName: string): string {
  return join(repositoryRoot, "packages", "eval", ".generated", "models", fileName);
}

export function packagedModelPath(resourcesRoot: string, fileName: string): string {
  return join(resourcesRoot, "models", fileName);
}

export function canonicalGenerationModelPath(repositoryRoot: string): string {
  return canonicalModelPath(repositoryRoot, generationModelFileName);
}

export function canonicalProjectorModelPath(repositoryRoot: string): string {
  return canonicalModelPath(repositoryRoot, projectorModelFileName);
}

export function packagedGenerationModelPath(resourcesRoot: string): string {
  return packagedModelPath(resourcesRoot, generationModelFileName);
}

export function packagedProjectorModelPath(resourcesRoot: string): string {
  return packagedModelPath(resourcesRoot, projectorModelFileName);
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

export function modelPackageFiles(repositoryRoot: string): Array<{ source: string; path: string }> {
  return [
    generationModelPackageFile(repositoryRoot),
    { source: canonicalProjectorModelPath(repositoryRoot), path: projectorModelResourcePath },
  ];
}

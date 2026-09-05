import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reportDevelopmentResourceStage } from "./src/dev-resource-progress.js";
import * as model from "./src/package-model-contract.js";
import type { ResourceHashes } from "./src/resource-hashes.js";

type HashFile = (path: string) => Promise<string>;
interface InferenceRuntimeManifest {
  platforms: Record<
    string,
    {
      dependencies?: Array<{ files: Record<string, string> }>;
      executable: string;
      files: Record<string, string>;
    }
  >;
}
const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const resourcesRoot = join(desktopRoot, "src-tauri", "resources", "core");

function runtimePlatforms(): string[] {
  if (process.platform === "darwin" && process.arch === "arm64") return ["macos-arm64"];
  if (process.platform === "win32" && process.arch === "x64")
    return ["windows-cuda-x64", "windows-vulkan-x64"];
  throw new Error("Unsupported inference package target.");
}

export function runtimeResourceNames(
  manifest: InferenceRuntimeManifest,
  platform: string,
): string[] {
  const runtime = manifest.platforms[platform];
  if (runtime === undefined) throw new Error("Image inspection runtime platform is missing.");
  const names = [
    ...Object.values(runtime.files),
    ...(runtime.dependencies ?? []).flatMap((dependency) => Object.values(dependency.files)),
  ];
  if (
    new Set(names).size !== names.length ||
    !names.includes(runtime.executable) ||
    names.some((name) => name.length === 0 || basename(name) !== name)
  ) {
    throw new Error("Image inspection runtime manifest is invalid.");
  }
  return names.sort();
}

async function requireFetchedAsset(path: string, fetchCommand: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(
      `Missing offline asset: ${path}. Run \`${fetchCommand}\` from the repository root to download it, then start again.`,
    );
  }
}

export async function installRuntimeResources(
  sha256: HashFile,
  destinationRoot: string,
): Promise<Pick<ResourceHashes, "inferenceRuntime">> {
  reportDevelopmentResourceStage("inferenceRuntime");
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, "assets/inference-runtime.json"), "utf8"),
  ) as InferenceRuntimeManifest;
  const hashes: Record<string, string> = {};
  for (const platform of runtimePlatforms()) {
    const source = join(repositoryRoot, "packages/eval/.generated/inference", platform);
    await requireFetchedAsset(source, `pnpm inference:fetch --platform ${platform}`);
    const destination = join(destinationRoot, platform);
    const names = runtimeResourceNames(manifest, platform);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await Promise.all(names.map((name) => copyFile(join(source, name), join(destination, name))));
    await chmod(
      join(destination, (manifest.platforms[platform] as { executable: string }).executable),
      0o755,
    );
    for (const entry of await readdir(destination, { withFileTypes: true })) {
      if (!entry.isFile()) throw new Error("Inference runtime must contain files only.");
      hashes[`${platform}/${entry.name}`] = await sha256(join(destination, entry.name));
    }
  }
  await mkdir(join(resourcesRoot, "licenses"), { recursive: true });
  const licenses = [
    "llama.cpp-LICENSE.txt",
    ...(process.platform === "win32" ? ["cuda-EULA.html", "llvm-OpenMP-LICENSE.txt"] : []),
  ];
  for (const license of licenses)
    await copyFile(
      join(repositoryRoot, "assets/licenses", license),
      join(resourcesRoot, "licenses", license),
    );
  return { inferenceRuntime: hashes };
}

export async function installImageModelResources(
  sha256: HashFile,
): Promise<Pick<ResourceHashes, "generationModel" | "projectorModel">> {
  reportDevelopmentResourceStage("model");
  const root = join(resourcesRoot, "models");
  await mkdir(root, { recursive: true });
  const candidates = [
    {
      modelId: model.generationModelId,
      storeKey: model.generationModelFileName,
      source: model.canonicalGenerationModelPath(repositoryRoot),
      runtimeBuild: "llama.cpp@b10816",
    },
    {
      modelId: model.projectorModelId,
      storeKey: model.projectorModelFileName,
      source: model.canonicalProjectorModelPath(repositoryRoot),
      runtimeBuild: "llama.cpp@b10816",
    },
  ] as const;
  for (const candidate of candidates) {
    await requireFetchedAsset(
      candidate.source,
      `pnpm model:fetch --id ${candidate.modelId} --destination ${candidate.source}`,
    );
  }
  const [generation, projector] = await Promise.all(
    candidates.map(async (candidate) => ({
      modelId: candidate.modelId,
      storeKey: candidate.storeKey,
      byteLength: (await stat(candidate.source)).size,
      sha256: await sha256(candidate.source),
      runtimeBuild: candidate.runtimeBuild,
      installedAt: "2026-08-15T00:00:00.000Z",
    })),
  );
  if (generation === undefined || projector === undefined) {
    throw new Error("Image model resource list is incomplete.");
  }
  await writeFile(
    join(root, "installed-models.json"),
    `${JSON.stringify({ schemaVersion: 1, models: [generation, projector] })}\n`,
  );
  return { generationModel: generation.sha256, projectorModel: projector.sha256 };
}

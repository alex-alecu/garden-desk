import { chmod, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reportDevelopmentResourceStage } from "./src/dev-resource-progress.js";
import * as model from "./src/package-model-contract.js";
import type { ResourceHashes } from "./src/resource-hashes.js";

type HashFile = (path: string) => Promise<string>;
interface VisionRuntimeManifest {
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

function visionPlatform(): "macos-arm64" | "windows-vulkan-x64" {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-vulkan-x64";
  throw new Error("Unsupported image inspection package target.");
}

export function visionResourceNames(manifest: VisionRuntimeManifest, platform: string): string[] {
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

export async function installVisionResources(
  sha256: HashFile,
): Promise<Pick<ResourceHashes, "visionRuntime">> {
  reportDevelopmentResourceStage("visionRuntime");
  const platform = visionPlatform();
  const source = join(repositoryRoot, "packages/eval/.generated/vision", platform);
  const destination = join(resourcesRoot, "inference", "vision");
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, "assets/vision-runtime.json"), "utf8"),
  ) as VisionRuntimeManifest;
  const names = visionResourceNames(manifest, platform);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await Promise.all(names.map((name) => copyFile(join(source, name), join(destination, name))));
  const executable = join(
    destination,
    process.platform === "win32" ? "llama-mtmd-cli.exe" : "llama-mtmd-cli",
  );
  await chmod(executable, 0o755);
  const hashes: Record<string, string> = {};
  for (const entry of await readdir(destination, { withFileTypes: true })) {
    if (!entry.isFile()) throw new Error("Image inspection runtime must contain files only.");
    hashes[entry.name] = await sha256(join(destination, entry.name));
  }
  await mkdir(join(resourcesRoot, "licenses"), { recursive: true });
  await copyFile(
    join(repositoryRoot, "assets/licenses/llama.cpp-LICENSE.txt"),
    join(resourcesRoot, "licenses/llama.cpp-LICENSE.txt"),
  );
  return { visionRuntime: hashes };
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
      runtimeBuild: "node-llama-cpp@3.19.0",
    },
    {
      modelId: model.projectorModelId,
      storeKey: model.projectorModelFileName,
      source: model.canonicalProjectorModelPath(repositoryRoot),
      runtimeBuild: "llama.cpp@b9842",
    },
  ] as const;
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

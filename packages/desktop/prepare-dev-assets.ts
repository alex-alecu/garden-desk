// biome-ignore lint/style/noRestrictedImports: Development setup runs the existing asset preparation commands.
import { spawnSync } from "node:child_process";
// biome-ignore lint/style/noRestrictedImports: Development setup checks local asset files.
import { existsSync } from "node:fs";
// biome-ignore lint/style/noRestrictedImports: Development setup reads the pinned asset manifests.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runtimeResourceNames } from "./package-image-resources.js";
import { canonicalModelPath, packagedModelFiles } from "./src/package-model-contract.js";
import { nativeRuntimePackages } from "./src/runtime-package-contract.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");

function run(script: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(repositoryRoot, script), ...args],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`Asset preparation failed: ${script}`);
}

function prepareModels(): void {
  for (const model of packagedModelFiles) {
    const destination = canonicalModelPath(repositoryRoot, model.fileName);
    if (existsSync(destination)) continue;
    console.log(`[Garden Desk setup] Downloading ${model.id}.`);
    run("packages/eval/src/gates/fetch-model.ts", ["--id", model.id, "--destination", destination]);
  }
}

async function prepareRuntimes(): Promise<void> {
  const manifest = JSON.parse(
    await readFile(join(repositoryRoot, "assets/inference-runtime.json"), "utf8"),
  ) as Parameters<typeof runtimeResourceNames>[0];
  for (const platform of nativeRuntimePackages()) {
    const directory = join(repositoryRoot, "packages/eval/.generated/inference", platform);
    if (runtimeResourceNames(manifest, platform).every((name) => existsSync(join(directory, name))))
      continue;
    console.log(`[Garden Desk setup] Downloading the ${platform} runtime.`);
    run("packages/eval/src/gates/fetch-inference-runtime.ts", ["--platform", platform]);
  }
}

async function prepareGuestImage(): Promise<void> {
  const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
  const imageRoot = join(repositoryRoot, "packages/workers/images");
  const manifest = JSON.parse(await readFile(join(imageRoot, "agent/manifest.json"), "utf8")) as {
    outputs: Record<string, { kernelFile: string; initramfsFile: string }>;
  };
  const output = manifest.outputs[architecture];
  if (output === undefined) throw new Error("Unsupported guest image architecture.");
  const directory = join(imageRoot, ".generated/agent/artifacts", architecture);
  if (
    existsSync(join(directory, output.kernelFile)) &&
    existsSync(join(directory, output.initramfsFile))
  )
    return;
  console.log("[Garden Desk setup] Building the missing guest image. This can take a long time.");
  run("packages/workers/images/build.ts", ["--agent", "--arch", architecture]);
}

await prepareRuntimes();
prepareModels();
await prepareGuestImage();

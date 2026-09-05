import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signExecutable } from "./build-signing.js";
import {
  canonicalGenerationModelPath,
  canonicalProjectorModelPath,
  packagedGenerationModelPath,
  packagedProjectorModelPath,
} from "./src/package-model-contract.js";
import { nativeRuntimePackages } from "./src/runtime-package-contract.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const tauriRoot = join(desktopRoot, "src-tauri");
const releaseRoot = join(tauriRoot, "target", "release");
const packageRoot = join(releaseRoot, "bundle", "windows", "Garden Desk");

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((accept, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", accept);
  });
  return digest.digest("hex");
}

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

async function packageRecord(
  application: string,
  sidecar: string,
): Promise<Record<string, unknown>> {
  const coreResources = join(packageRoot, "resources", "core");
  const resourceManifest = join(coreResources, "resource-manifest.json");
  const model = join(coreResources, "models", "qwen3.8-27b-ud-iq4_xs.gguf");
  const projector = join(coreResources, "models", "qwen3.8-27b-mmproj-f16.gguf");
  const inferenceRuntimes = nativeRuntimePackages();
  await Promise.all(
    inferenceRuntimes.map((name) =>
      stat(join(coreResources, "inference", name, "llama-server.exe")),
    ),
  );
  return {
    schemaVersion: 1,
    format: "windows-portable-directory",
    architecture: process.arch,
    application: { file: basename(application), sha256: await sha256(application) },
    sidecar: { file: basename(sidecar), sha256: await sha256(sidecar) },
    resources: {
      manifestSha256: await sha256(resourceManifest),
      generationModelBytes: (await stat(model)).size,
      generationModelSha256: await sha256(model),
      projectorModelBytes: (await stat(projector)).size,
      projectorModelSha256: await sha256(projector),
      inferenceRuntimes,
    },
  };
}

export async function stageWindowsApplication(): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The Windows application package requires Windows x64.");
  }
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(packageRoot, { recursive: true });
  const application = join(packageRoot, "Garden Desk.exe");
  const sidecar = join(packageRoot, "garden-desk-core.exe");
  await copyFile(join(releaseRoot, "garden-desk-desktop.exe"), application);
  const applicationSigningMode = signExecutable(application);
  await copyFile(
    join(tauriRoot, "binaries", "garden-desk-core-x86_64-pc-windows-msvc.exe"),
    sidecar,
  );
  await copyTree(join(tauriRoot, "resources", "core"), join(packageRoot, "resources", "core"));
  const packagedModel = packagedGenerationModelPath(join(packageRoot, "resources", "core"));
  const packagedProjector = packagedProjectorModelPath(join(packageRoot, "resources", "core"));
  await mkdir(join(packageRoot, "resources", "core", "models"), { recursive: true });
  await copyFile(canonicalGenerationModelPath(join(desktopRoot, "../..")), packagedModel);
  await copyFile(canonicalProjectorModelPath(join(desktopRoot, "../..")), packagedProjector);
  await mkdir(join(packageRoot, "assets", "fonts"), { recursive: true });
  await copyFile(
    join(desktopRoot, "..", "..", "assets", "fonts", "LICENSE.txt"),
    join(packageRoot, "assets", "fonts", "LICENSE.txt"),
  );
  const record = {
    ...(await packageRecord(application, sidecar)),
    applicationSigningMode,
  };
  await writeFile(
    join(packageRoot, "windows-package.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(JSON.stringify({ windowsApplication: packageRoot, record }));
}

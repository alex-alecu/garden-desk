import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { signExecutable } from "./build-signing.js";
import { writePackageCompliance, writePackageIdentity } from "./package-compliance.js";
import { installImageModelResources, installVisionResources } from "./package-image-resources.js";
import { copyRuntimePackage } from "./runtime-packages.js";
import { reportDevelopmentResourceStage } from "./src/dev-resource-progress.js";
import * as model from "./src/package-model-contract.js";
import { packagedMigrationNames } from "./src/package-resource-contract.js";
import type { ResourceHashes } from "./src/resource-hashes.js";
import { installWindowsCudaAssets } from "./windows-runtime-assets.js";
import { installWindowsSetupHelper } from "./windows-setup-resource.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const resourcesRoot = join(desktopRoot, "src-tauri", "resources", "core");
const inferenceRoot = join(resourcesRoot, "inference");
const workerResourcesRoot = join(resourcesRoot, "workers");

export type { ResourceHashes } from "./src/resource-hashes.js";

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe" });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function runPnpm(args: string[]): void {
  const pnpm = process.env.npm_execpath;
  if (pnpm === undefined) throw new Error("pnpm must invoke the desktop resource build.");
  run(process.execPath, [pnpm, "--dir", repositoryRoot, ...args]);
}

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

async function installAgentImage(
  architecture: "aarch64" | "x86_64",
  kernelName: "Image" | "bzImage",
): Promise<Pick<ResourceHashes, "agentKernel" | "agentInitramfs">> {
  reportDevelopmentResourceStage("agentImage");
  const imageSource = join(repositoryRoot, "packages/workers/images");
  const imageDestination = join(workerResourcesRoot, "images");
  const artifactDestination = join(imageDestination, ".generated/agent/artifacts", architecture);
  await mkdir(join(imageDestination, "agent"), { recursive: true });
  await mkdir(artifactDestination, { recursive: true });
  await copyFile(
    join(imageSource, "agent/manifest.json"),
    join(imageDestination, "agent/manifest.json"),
  );
  await copyFile(
    join(imageSource, "agent/capabilities.json"),
    join(imageDestination, "agent/capabilities.json"),
  );
  const kernel = join(artifactDestination, kernelName);
  const initramfs = join(artifactDestination, "rootfs.cpio");
  const artifactSource = join(imageSource, ".generated/agent/artifacts", architecture);
  await copyFile(join(artifactSource, kernelName), kernel);
  await copyFile(join(artifactSource, "rootfs.cpio"), initramfs);
  const hashes = { agentKernel: await sha256(kernel), agentInitramfs: await sha256(initramfs) };
  const manifest = JSON.parse(await readFile(join(imageSource, "agent/manifest.json"), "utf8")) as {
    outputs: Record<string, { kernelSha256: string; initramfsSha256: string }>;
  };
  const expected = manifest.outputs[architecture];
  if (
    expected?.kernelSha256 !== hashes.agentKernel ||
    expected.initramfsSha256 !== hashes.agentInitramfs
  ) {
    throw new Error(`Packaged ${architecture} guest image does not match its manifest.`);
  }
  return hashes;
}

async function installMacAgentResources(): Promise<
  Pick<ResourceHashes, "agentHelper" | "agentHelperSignature" | "agentKernel" | "agentInitramfs">
> {
  reportDevelopmentResourceStage("agentHelper");
  runPnpm(["workers:macos:build"]);
  await mkdir(workerResourcesRoot, { recursive: true });
  const helper = join(workerResourcesRoot, "vault-vz-helper");
  await copyFile(
    join(repositoryRoot, "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper"),
    helper,
  );
  await chmod(helper, 0o755);
  return {
    agentHelper: await sha256(helper),
    agentHelperSignature: "macos-adhoc",
    ...(await installAgentImage("aarch64", "Image")),
  };
}

async function installWindowsAgentResources(): Promise<
  Pick<ResourceHashes, "agentHelper" | "agentHelperSignature" | "agentKernel" | "agentInitramfs">
> {
  reportDevelopmentResourceStage("agentHelper");
  runPnpm(["workers:windows:build"]);
  await mkdir(workerResourcesRoot, { recursive: true });
  const helper = join(workerResourcesRoot, "vault-hcs-helper.exe");
  await copyFile(
    join(
      repositoryRoot,
      "packages/workers/native/windows-hcs-helper/.generated/vault-hcs-helper.exe",
    ),
    helper,
  );
  const agentHelperSignature = signExecutable(helper);
  return {
    agentHelper: await sha256(helper),
    agentHelperSignature,
    ...(await installAgentImage("x86_64", "bzImage")),
  };
}

async function installWindowsInferenceHelper(
  destinationRoot: string,
): Promise<Pick<ResourceHashes, "inferenceHelper" | "inferenceHelperSignature">> {
  reportDevelopmentResourceStage("inferenceIsolation");
  runPnpm(["workers:windows-native:build"]);
  const helper = join(destinationRoot, "vault-appcontainer-launcher.exe");
  await copyFile(
    join(
      repositoryRoot,
      "packages/workers/native/windows-appcontainer-launcher/.generated/vault-appcontainer-launcher.exe",
    ),
    helper,
  );
  const inferenceHelperSignature = signExecutable(helper);
  return {
    inferenceHelper: await sha256(helper),
    inferenceHelperSignature,
  };
}

export async function installInferenceResources(
  destinationRoot = inferenceRoot,
): Promise<
  Pick<
    ResourceHashes,
    | "inferenceHelper"
    | "inferenceHelperSignature"
    | "inferenceRuntime"
    | "inferenceRuntimeSignature"
    | "inferenceWorker"
    | "cudaAssets"
  >
> {
  await mkdir(destinationRoot, { recursive: true });
  reportDevelopmentResourceStage("inferenceWorker");
  const worker = join(destinationRoot, "worker.mjs");
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [join(repositoryRoot, "packages/workers/src/inference/worker.ts")],
    outfile: worker,
    bundle: true,
    external: ["node-llama-cpp"],
    format: "esm",
    platform: "node",
    target: "node24",
  });
  reportDevelopmentResourceStage("inferenceRuntime");
  await copyRuntimePackage(
    "node-llama-cpp",
    createRequire(join(repositoryRoot, "packages/workers/package.json")),
    join(destinationRoot, "node_modules"),
    new Set(),
  );
  const runtime = join(destinationRoot, process.platform === "win32" ? "node.exe" : "node");
  await copyFile(process.execPath, runtime);
  await chmod(runtime, 0o755);
  const inferenceRuntimeSignature = signExecutable(runtime);
  const isolation =
    process.platform === "win32" ? await installWindowsInferenceHelper(destinationRoot) : {};
  if (process.platform === "win32") reportDevelopmentResourceStage("cudaRuntime");
  return {
    ...isolation,
    ...(process.platform === "win32"
      ? { cudaAssets: await installWindowsCudaAssets(destinationRoot) }
      : {}),
    inferenceRuntime: await sha256(runtime),
    inferenceRuntimeSignature,
    inferenceWorker: await sha256(worker),
  };
}

export async function rebuildInferenceResources(
  destinationRoot: string,
): ReturnType<typeof installInferenceResources> {
  await rm(destinationRoot, { recursive: true, force: true });
  return await installInferenceResources(destinationRoot);
}

function productBuild(): boolean {
  return (
    !process.argv.includes("--check") &&
    (process.platform === "darwin" || process.platform === "win32")
  );
}

async function installProductResources(): Promise<Omit<ResourceHashes, "migrations">> {
  return {
    ...(await installInferenceResources()),
    ...(await installVisionResources(sha256)),
    ...(process.platform === "win32"
      ? {
          ...(await installWindowsSetupHelper({
            build: () => runPnpm(["desktop:windows-hyper-v-setup:build"]),
            repositoryRoot,
            resourcesRoot,
            sha256,
          })),
          ...(await installWindowsAgentResources()),
        }
      : await installMacAgentResources()),
    ...(await installImageModelResources(sha256)),
  };
}

async function installWindowsPipeGuard(): Promise<string | undefined> {
  if (process.platform !== "win32" || process.argv.includes("--check")) return undefined;
  reportDevelopmentResourceStage("currentUserTransport");
  runPnpm(["core:windows-pipe-guard:build"]);
  const pipeGuard = join(resourcesRoot, "vault-pipe-guard.exe");
  await copyFile(
    join(repositoryRoot, "packages/core/native/windows-pipe-guard/.generated/vault-pipe-guard.exe"),
    pipeGuard,
  );
  return await sha256(pipeGuard);
}

export async function installResources(
  identity: { executableSha256: string; signingMode: string },
  targetTriple: string,
): Promise<ResourceHashes> {
  const promptResources = join(resourcesRoot, "prompts");
  await rm(promptResources, { force: true, recursive: true });
  await cp(join(repositoryRoot, "prompts"), promptResources, { recursive: true });
  const migrations: Record<string, string> = {};
  for (const name of packagedMigrationNames) {
    const source = join(repositoryRoot, "packages/core/src/workspace/migrations", name);
    const destination = join(resourcesRoot, "migrations", name);
    await copyFile(source, destination);
    migrations[name] = await sha256(destination);
  }
  const windowsPipeGuard = await installWindowsPipeGuard();
  const productResources = productBuild() ? await installProductResources() : {};
  await writePackageIdentity(resourcesRoot, {
    schemaVersion: 1,
    targetTriple,
    sidecar: identity,
    resources: { migrations, ...productResources },
  });
  if (productBuild()) reportDevelopmentResourceStage("manifest");
  const resourceManifest = productBuild()
    ? await writePackageCompliance(
        resourcesRoot,
        join(workerResourcesRoot, "images/agent/manifest.json"),
        model.modelPackageFiles(repositoryRoot),
      )
    : undefined;
  return {
    migrations,
    ...(windowsPipeGuard === undefined ? {} : { windowsPipeGuard }),
    ...productResources,
    ...(resourceManifest === undefined ? {} : { resourceManifest }),
  };
}

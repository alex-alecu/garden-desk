import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { signExecutable, stripWindowsSignature } from "./build-signing.js";
import { debugSidecarCheckArguments } from "./debug-sidecar-check.js";
import { writePackageCompliance, writePackageIdentity } from "./package-compliance.js";
import { copyRuntimePackage } from "./runtime-packages.js";
import { seaConfiguration } from "./sidecar-sea.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const tauriRoot = join(desktopRoot, "src-tauri");
const generatedRoot = join(desktopRoot, ".generated", "sidecar");
const resourcesRoot = join(tauriRoot, "resources", "core");
const inferenceRoot = join(resourcesRoot, "inference");
const workerResourcesRoot = join(resourcesRoot, "workers");
const modelResourcesRoot = join(resourcesRoot, "models");
const binariesRoot = join(tauriRoot, "binaries");
const migrationNames = [
  "0001-initial.sql",
  "0002-audit-head.sql",
  "0003-conversations.sql",
  "0004-agent.sql",
  "0005-agent-performance.sql",
  "0006-agent-workspace.sql",
  "0007-agent-executions.sql",
  "0008-agent-inference-traces.sql",
];

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: "pipe" });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function targetTriple(): string {
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[`${process.platform}-${process.arch}`];
  if (triple === undefined) throw new Error("Unsupported Vault Desk desktop build host.");
  return triple;
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

async function buildBundle(): Promise<string> {
  const output = join(generatedRoot, "vault-core.cjs");
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [join(repositoryRoot, "packages/core/src/daemon/main.ts")],
    outfile: output,
    bundle: true,
    conditions: ["vault-runtime"],
    define: { "import.meta.url": '"file:///vault-core.cjs"' },
    format: "cjs",
    platform: "node",
    target: "node24",
  });
  return output;
}

async function prepareSea(bundle: string): Promise<string> {
  if (process.version !== "v24.18.0") {
    throw new Error(`Expected Node v24.18.0, received ${process.version}.`);
  }
  const blob = join(generatedRoot, "vault-core.blob");
  const executable = join(
    generatedRoot,
    process.platform === "win32" ? "vault-core.exe" : "vault-core",
  );
  const config = join(generatedRoot, "sea-config.json");
  await writeFile(config, seaConfiguration(bundle, blob));
  run(process.execPath, ["--experimental-sea-config", config]);
  await copyFile(process.execPath, executable);
  const postject = join(desktopRoot, "node_modules", "postject", "dist", "cli.js");
  if (process.platform === "darwin") {
    spawnSync("codesign", ["--remove-signature", executable]);
  } else {
    stripWindowsSignature(executable);
  }
  const args = [
    executable,
    "NODE_SEA_BLOB",
    blob,
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  run(process.execPath, [postject, ...args]);
  return executable;
}

interface ResourceHashes {
  migrations: Record<string, string>;
  windowsPipeGuard?: string;
  inferenceRuntime?: string;
  inferenceRuntimeSignature?: string;
  inferenceWorker?: string;
  agentHelper?: string;
  agentHelperSignature?: string;
  agentKernel?: string;
  agentInitramfs?: string;
  generationModel?: string;
  resourceManifest?: string;
}
type PackageIdentity = { executableSha256: string; signingMode: string };

async function installMacAgentResources(): Promise<
  Pick<ResourceHashes, "agentHelper" | "agentHelperSignature" | "agentKernel" | "agentInitramfs">
> {
  run("pnpm", ["--dir", repositoryRoot, "workers:macos:build"], process.env);
  await mkdir(workerResourcesRoot, { recursive: true });
  const helper = join(workerResourcesRoot, "vault-vz-helper");
  await copyFile(
    join(repositoryRoot, "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper"),
    helper,
  );
  await chmod(helper, 0o755);
  const imageSource = join(repositoryRoot, "packages/workers/images");
  const imageDestination = join(workerResourcesRoot, "images");
  await mkdir(join(imageDestination, "agent"), { recursive: true });
  await mkdir(join(imageDestination, ".generated/agent/artifacts/aarch64"), { recursive: true });
  await copyFile(
    join(imageSource, "agent/manifest.json"),
    join(imageDestination, "agent/manifest.json"),
  );
  await copyFile(
    join(imageSource, "agent/capabilities.json"),
    join(imageDestination, "agent/capabilities.json"),
  );
  const kernel = join(imageDestination, ".generated/agent/artifacts/aarch64/Image");
  const initramfs = join(imageDestination, ".generated/agent/artifacts/aarch64/rootfs.cpio");
  await copyFile(join(imageSource, ".generated/agent/artifacts/aarch64/Image"), kernel);
  await copyFile(join(imageSource, ".generated/agent/artifacts/aarch64/rootfs.cpio"), initramfs);
  return {
    agentHelper: await sha256(helper),
    agentHelperSignature: "macos-adhoc",
    agentKernel: await sha256(kernel),
    agentInitramfs: await sha256(initramfs),
  };
}

async function installInferenceResources(): Promise<
  Pick<ResourceHashes, "inferenceRuntime" | "inferenceRuntimeSignature" | "inferenceWorker">
> {
  await mkdir(inferenceRoot, { recursive: true });
  const worker = join(inferenceRoot, "worker.mjs");
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
  await copyRuntimePackage(
    "node-llama-cpp",
    createRequire(join(repositoryRoot, "packages/workers/package.json")),
    join(inferenceRoot, "node_modules"),
    new Set(),
  );
  const runtime = join(inferenceRoot, "node");
  await copyFile(process.execPath, runtime);
  await chmod(runtime, 0o755);
  const inferenceRuntimeSignature = signExecutable(runtime);
  return {
    inferenceRuntime: await sha256(runtime),
    inferenceRuntimeSignature,
    inferenceWorker: await sha256(worker),
  };
}

async function installModelResources(): Promise<Pick<ResourceHashes, "generationModel">> {
  await mkdir(modelResourcesRoot, { recursive: true });
  const modelName = "gemma-4-12b-it-qat-q4_0.gguf";
  const source = join(repositoryRoot, "packages/eval/.generated/models", modelName);
  const destination = join(modelResourcesRoot, modelName);
  await copyFile(source, destination, constants.COPYFILE_FICLONE);
  const digest = await sha256(destination);
  const size = (await stat(destination)).size;
  await writeFile(
    join(modelResourcesRoot, "installed-models.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          modelId: "gemma-4-12b-it-qat-q4_0",
          storeKey: modelName,
          byteLength: size,
          sha256: digest,
          runtimeBuild: "node-llama-cpp@3.19.0",
          installedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
    })}\n`,
  );
  return { generationModel: digest };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: resource hashes, package identity, notices, and SBOM stay in one atomic packaging boundary.
async function installResources(identity: PackageIdentity): Promise<ResourceHashes> {
  const migrations: Record<string, string> = {};
  for (const name of migrationNames) {
    const source = join(repositoryRoot, "packages/core/src/workspace/migrations", name);
    const destination = join(resourcesRoot, "migrations", name);
    await copyFile(source, destination);
    migrations[name] = await sha256(destination);
  }
  let windowsPipeGuard: string | undefined;
  if (process.platform === "win32" && !process.argv.includes("--check")) {
    run("pnpm", ["--dir", repositoryRoot, "core:windows-pipe-guard:build"], process.env);
    const pipeGuard = join(resourcesRoot, "vault-pipe-guard.exe");
    await copyFile(
      join(
        repositoryRoot,
        "packages/core/native/windows-pipe-guard/.generated/vault-pipe-guard.exe",
      ),
      pipeGuard,
    );
    windowsPipeGuard = await sha256(pipeGuard);
  }
  const productResources =
    process.platform === "darwin" && !process.argv.includes("--check")
      ? {
          ...(await installInferenceResources()),
          ...(await installMacAgentResources()),
          ...(await installModelResources()),
        }
      : {};
  await writePackageIdentity(resourcesRoot, {
    schemaVersion: 1,
    targetTriple: targetTriple(),
    sidecar: identity,
    resources: { migrations, ...productResources },
  });
  const resourceManifest =
    process.platform === "darwin" && !process.argv.includes("--check")
      ? await writePackageCompliance(
          resourcesRoot,
          join(workerResourcesRoot, "images/agent/manifest.json"),
        )
      : undefined;
  return {
    migrations,
    ...(windowsPipeGuard === undefined ? {} : { windowsPipeGuard }),
    ...productResources,
    ...(resourceManifest === undefined ? {} : { resourceManifest }),
  };
}

await rm(generatedRoot, { recursive: true, force: true });
await rm(resourcesRoot, { recursive: true, force: true });
await mkdir(generatedRoot, { recursive: true });
await mkdir(join(resourcesRoot, "migrations"), { recursive: true });
await mkdir(binariesRoot, { recursive: true });
const bundle = await buildBundle();
const executable = await prepareSea(bundle);
await chmod(executable, 0o755);
const signingMode = signExecutable(executable);
const extension = process.platform === "win32" ? ".exe" : "";
const installed = join(binariesRoot, `vault-core-${targetTriple()}${extension}`);
await copyFile(executable, installed);
await chmod(installed, 0o755);
if (process.argv.includes("--check"))
  run(process.execPath, debugSidecarCheckArguments(repositoryRoot, installed));
const executableSha256 = await sha256(installed);
const resources = await installResources({ executableSha256, signingMode });
const record = {
  schemaVersion: 1,
  nodeVersion: process.version,
  targetTriple: targetTriple(),
  signingMode,
  executableSha256,
  bundleSha256: await sha256(bundle),
  resources,
};
await writeFile(join(generatedRoot, "build-record.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record));

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { signExecutable, stripWindowsSignature } from "./build-signing.js";
import { debugSidecarCheckArguments } from "./debug-sidecar-check.js";
import { installResources } from "./package-resources.js";
import { seaConfiguration } from "./sidecar-sea.js";
import { reportDevelopmentResourceStage } from "./src/dev-resource-progress.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const tauriRoot = join(desktopRoot, "src-tauri");
const generatedRoot = join(desktopRoot, ".generated", "sidecar");
const resourcesRoot = join(tauriRoot, "resources", "core");
const binariesRoot = join(tauriRoot, "binaries");

export type DesktopBuildMode = "development" | "production";

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
  if (triple === undefined) throw new Error("Unsupported Garden Desk desktop build host.");
  return triple;
}

function compileSharedRuntime(): void {
  const tsc = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "-b", join(repositoryRoot, "packages", "shared")]);
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

function buildDefines(mode: DesktopBuildMode): Record<string, string> {
  const developmentBuild = mode === "development";
  return {
    "globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__": String(developmentBuild),
    "globalThis.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__": JSON.stringify(
      developmentBuild
        ? join(repositoryRoot, "packages", "eval", ".generated", "inference-diagnostics")
        : "",
    ),
  };
}

async function buildBundle(mode: DesktopBuildMode): Promise<string> {
  const output = join(generatedRoot, "garden-desk-core.cjs");
  await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [join(repositoryRoot, "packages/core/src/daemon/main.ts")],
    outfile: output,
    bundle: true,
    conditions: ["gardendesk-runtime"],
    define: { "import.meta.url": '"file:///garden-desk-core.cjs"', ...buildDefines(mode) },
    format: "cjs",
    platform: "node",
    target: "node24",
    minifySyntax: true,
  });
  return output;
}

async function prepareSea(bundle: string): Promise<string> {
  if (process.version !== "v24.18.0") {
    throw new Error(`Expected Node v24.18.0, received ${process.version}.`);
  }
  const blob = join(generatedRoot, "garden-desk-core.blob");
  const executable = join(
    generatedRoot,
    process.platform === "win32" ? "garden-desk-core.exe" : "garden-desk-core",
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

export async function buildSidecar(mode: DesktopBuildMode, check = false): Promise<void> {
  await rm(generatedRoot, { recursive: true, force: true });
  await rm(resourcesRoot, { recursive: true, force: true });
  await mkdir(generatedRoot, { recursive: true });
  await mkdir(join(resourcesRoot, "migrations"), { recursive: true });
  await mkdir(binariesRoot, { recursive: true });
  reportDevelopmentResourceStage("coreBundle");
  compileSharedRuntime();
  const bundle = await buildBundle(mode);
  reportDevelopmentResourceStage("coreExecutable");
  const executable = await prepareSea(bundle);
  await chmod(executable, 0o755);
  const signingMode = signExecutable(executable);
  const extension = process.platform === "win32" ? ".exe" : "";
  const installed = join(binariesRoot, `garden-desk-core-${targetTriple()}${extension}`);
  await copyFile(executable, installed);
  await chmod(installed, 0o755);
  if (check) run(process.execPath, debugSidecarCheckArguments(repositoryRoot, installed));
  const executableSha256 = await sha256(installed);
  const resources = await installResources({ executableSha256, signingMode }, targetTriple(), mode);
  const record = {
    schemaVersion: 1,
    buildMode: mode,
    nodeVersion: process.version,
    targetTriple: targetTriple(),
    signingMode,
    executableSha256,
    bundleSha256: await sha256(bundle),
    resources,
  };
  await writeFile(join(generatedRoot, "build-record.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify(record));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildSidecar("production", process.argv.includes("--check"));
}

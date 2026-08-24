import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";

const repositoryRoot = process.cwd();
const diagnosticRoot = join(
  repositoryRoot,
  "packages",
  "eval",
  ".generated",
  "inference-diagnostics",
);
const headlessRoot = join(
  repositoryRoot,
  "packages",
  "eval",
  ".generated",
  "development-inference-headless",
);
const migrationSource = join(repositoryRoot, "packages", "core", "src", "workspace", "migrations");
const migrationDestination = join(headlessRoot, "migrations");
let diagnosticPreparation: Promise<void> | undefined;
let migrationPreparation: Promise<void> | undefined;

async function windowsInferenceRoot(): Promise<string> {
  const { windowsInferencePaths } = await import("./windows-inference.js");
  const production = await windowsInferencePaths();
  return dirname(production.workerEntryPath);
}

async function developmentWorkerEntries(): Promise<[string, string]> {
  const root = process.platform === "win32" ? await windowsInferenceRoot() : undefined;
  const worker = developmentInferenceWorkerEntryPath(process.platform, root);
  return [worker, join(dirname(worker), "hardware-worker.mjs")];
}

export async function prepareDevelopmentInferenceWorker(): Promise<void> {
  const [worker, hardwareWorker] = await developmentWorkerEntries();
  await mkdir(dirname(worker), { recursive: true });
  const entries = [
    ["packages/workers/src/inference/worker.ts", worker],
    ["packages/workers/src/inference/hardware-worker.ts", hardwareWorker],
  ] as const;
  await Promise.all(
    entries.map(async ([entryPoint, outfile]) => {
      await build({
        absWorkingDir: repositoryRoot,
        bundle: true,
        define: {
          "globalThis.__VAULT_DEVELOPMENT_BUILD__": "true",
          "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": '""',
        },
        entryPoints: [entryPoint],
        external: ["node-llama-cpp"],
        format: "esm",
        minifySyntax: true,
        outfile,
        platform: "node",
        target: "node24",
      });
    }),
  );
}

function headlessOutput(entry: URL): string {
  const name = fileURLToPath(entry).split(/[\\/]/u).at(-1)?.replace(".ts", ".mjs");
  if (name === undefined) throw new Error("Development headless entry name is missing.");
  return join(headlessRoot, name);
}

export async function prepareDevelopmentDiagnosticRoot(root = diagnosticRoot): Promise<void> {
  const resolvedRoot = resolve(root);
  const obsoleteHeadless = resolve(resolvedRoot, "headless");
  if (relative(resolvedRoot, obsoleteHeadless) !== "headless") {
    throw new Error("Development diagnostic legacy path is invalid.");
  }
  await rm(obsoleteHeadless, { recursive: true, force: true });
}

function prepareDevelopmentDiagnostics(): Promise<void> {
  diagnosticPreparation ??= prepareDevelopmentDiagnosticRoot();
  return diagnosticPreparation;
}

function prepareHeadlessMigrations(): Promise<void> {
  migrationPreparation ??= (async () => {
    await rm(migrationDestination, { recursive: true, force: true });
    await cp(migrationSource, migrationDestination, { recursive: true });
  })();
  return migrationPreparation;
}

function runHeadlessEntry(path: string): void {
  const result = spawnSync(process.execPath, [path, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

export async function buildDevelopmentHeadlessEntry(entry: URL): Promise<string> {
  const output = headlessOutput(entry);
  await Promise.all([prepareDevelopmentDiagnostics(), prepareHeadlessMigrations()]);
  await mkdir(dirname(output), { recursive: true });
  await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    define: {
      "globalThis.__VAULT_DEVELOPMENT_BUILD__": "true",
      "globalThis.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__": JSON.stringify(diagnosticRoot),
    },
    entryPoints: [fileURLToPath(entry)],
    external: ["better-sqlite3", "node-llama-cpp", "tar-stream"],
    format: "esm",
    minifySyntax: true,
    outfile: output,
    platform: "node",
    target: "node24",
  });
  await stat(output);
  return output;
}

export async function runDevelopmentHeadlessEntry(entry: URL): Promise<void> {
  await prepareDevelopmentInferenceWorker();
  runHeadlessEntry(await buildDevelopmentHeadlessEntry(entry));
}

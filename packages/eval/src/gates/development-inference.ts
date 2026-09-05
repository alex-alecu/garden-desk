import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

type HeadlessFailureStage = "fixture" | "environment_setup" | "runtime_startup";

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

export function requireHeadlessExitStatus(result: {
  error?: Error;
  status: number | null;
}): number {
  if (result.error !== undefined) throw result.error;
  if (result.status === null) throw new Error("development_headless_terminated");
  return result.status;
}

function runHeadlessEntry(path: string): void {
  const status = requireHeadlessExitStatus(
    spawnSync(process.execPath, [path, ...process.argv.slice(2)], {
      stdio: "inherit",
    }),
  );
  if (status !== 0) process.exitCode = status;
}

export async function buildDevelopmentHeadlessEntry(entry: URL): Promise<string> {
  const output = headlessOutput(entry);
  await Promise.all([prepareDevelopmentDiagnostics(), prepareHeadlessMigrations()]);
  await mkdir(dirname(output), { recursive: true });
  await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    define: {
      "globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__": "true",
      "globalThis.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__": JSON.stringify(diagnosticRoot),
    },
    entryPoints: [fileURLToPath(entry)],
    external: ["better-sqlite3", "tar-stream"],
    format: "esm",
    logLevel: "silent",
    minifySyntax: true,
    outfile: output,
    platform: "node",
    target: "node24",
  });
  await stat(output);
  return output;
}

export async function runDevelopmentHeadlessEntry(
  entry: URL,
  failureClassification: string,
): Promise<void> {
  let stage: HeadlessFailureStage = "environment_setup";
  try {
    stage = "fixture";
    const output = await buildDevelopmentHeadlessEntry(entry);
    stage = "environment_setup";
    stage = "runtime_startup";
    runHeadlessEntry(output);
  } catch {
    console.error(JSON.stringify({ classification: failureClassification, stage }));
    process.exitCode = 1;
  }
}

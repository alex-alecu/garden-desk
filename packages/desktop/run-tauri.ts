import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanModelCopies,
  cleanupDevelopmentModelOutput,
  packageBuildTarget,
  preparePackageBuild,
  rollbackPackageBuild,
} from "./package-output-cleanup.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

function pathVariable(): string {
  return Object.keys(process.env).find((name) => name.toLowerCase() === "path") ?? "PATH";
}

function cargoDirectory(currentPath: string): string {
  const executable = process.platform === "win32" ? "cargo.exe" : "cargo";
  const candidates = [
    ...(process.env.CARGO_HOME === undefined ? [] : [join(process.env.CARGO_HOME, "bin")]),
    join(homedir(), ".cargo", "bin"),
    ...currentPath.split(delimiter),
  ];
  const directory = candidates.find((candidate) => existsSync(join(candidate, executable)));
  if (directory === undefined) {
    throw new Error("Cargo was not found in PATH, CARGO_HOME/bin, or ~/.cargo/bin.");
  }
  return directory;
}

const pathName = pathVariable();
const currentPath = process.env[pathName] ?? "";
const rustBin = cargoDirectory(currentPath);
const tauriCli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
const tauriArguments = process.argv.slice(2);
if (
  process.platform === "win32" &&
  tauriArguments[0] === "dev" &&
  !tauriArguments.includes("--no-watch")
) {
  tauriArguments.push("--no-watch");
}
const packageTarget = packageBuildTarget(
  desktopRoot,
  process.platform,
  process.arch,
  tauriArguments,
);
const packageBackupCreated =
  packageTarget === undefined ? false : await preparePackageBuild(packageTarget);
const result = spawnSync(process.execPath, [tauriCli, ...tauriArguments], {
  env: { ...process.env, [pathName]: [rustBin, currentPath].filter(Boolean).join(delimiter) },
  stdio: "inherit",
});
if (tauriArguments[0] === "dev") await cleanupDevelopmentModelOutput(desktopRoot);
if (result.error !== undefined) {
  if (packageTarget !== undefined) {
    await rollbackPackageBuild(packageTarget, packageBackupCreated);
  }
  throw result.error;
}
if (result.status !== 0) {
  if (packageTarget !== undefined) {
    await rollbackPackageBuild(packageTarget, packageBackupCreated);
  }
  process.exitCode = result.status ?? 1;
} else if (packageTarget !== undefined) {
  try {
    if (process.platform === "win32") {
      const { stageWindowsApplication } = await import("./stage-windows-application.js");
      await stageWindowsApplication();
    }
    await cleanModelCopies(packageTarget);
  } catch (error) {
    await rollbackPackageBuild(packageTarget, packageBackupCreated);
    throw error;
  }
}

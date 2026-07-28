import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

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
const result = spawnSync(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  env: { ...process.env, [pathName]: [rustBin, currentPath].filter(Boolean).join(delimiter) },
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
if (
  process.exitCode === 0 &&
  process.platform === "win32" &&
  process.argv[2] === "build" &&
  !process.argv.includes("--debug")
) {
  const { stageWindowsApplication } = await import("./stage-windows-application.js");
  await stageWindowsApplication();
}

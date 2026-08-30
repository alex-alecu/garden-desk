import { spawnSync } from "node:child_process";

function milestoneArgument(): string {
  const index = process.argv.indexOf("--milestone");
  const milestone = process.argv[index + 1];
  if (index === -1 || milestone === undefined) {
    throw new Error("Usage: pnpm test:gate --milestone <0|1|2|3>");
  }
  return milestone;
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runPnpm(args: string[]): void {
  const pnpmScript = process.env.npm_execpath;
  if (pnpmScript === undefined) throw new Error("Run the M0 gate through the pinned pnpm script.");
  run(process.execPath, [pnpmScript, ...args]);
}

function requiredModelPath(): string {
  const index = process.argv.indexOf("--model");
  const path = process.argv[index + 1];
  if (index === -1 || path === undefined) {
    throw new Error("M0 closure requires --model <path> for the pinned Qwen GGUF.");
  }
  return path;
}

const milestone = milestoneArgument();
if (milestone === "3") {
  runPnpm(["verify"]);
  runPnpm(["tauri:check"]);
  if (process.platform === "darwin") runPnpm(["test:m3:macos"]);
  else if (process.platform === "win32") runPnpm(["test:m3:windows"]);
  else throw new Error("Milestone 3 acceptance runs on physical macOS or Windows hardware.");
} else if (milestone === "2") {
  runPnpm(["verify"]);
  runPnpm(["test:native:m2"]);
  runPnpm(["test:m2:native"]);
} else if (milestone === "1") {
  runPnpm(["verify"]);
  runPnpm(["test:platform:gate"]);
} else if (milestone === "0") {
  const modelPath = requiredModelPath();
  runPnpm(["verify"]);
  runPnpm(["tauri:check"]);
  run(process.execPath, [
    "--import",
    "tsx",
    "packages/eval/src/gates/model-smoke.ts",
    "--model",
    modelPath,
  ]);
  runPnpm(["test:platform:m0", "--require-certified"]);
} else {
  throw new Error("Only milestone gates 0, 1, 2, and 3 exist.");
}

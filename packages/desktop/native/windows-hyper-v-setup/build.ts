import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { signExecutable } from "../../build-signing.js";

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: "pipe" });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

if (process.platform === "win32") {
  const root = join(process.cwd(), "packages/desktop/native/windows-hyper-v-setup");
  const generated = join(root, ".generated");
  const target = join(generated, "target");
  mkdirSync(generated, { recursive: true });
  run("cargo", ["build", "--release", "--locked", "--manifest-path", join(root, "Cargo.toml")], {
    ...process.env,
    CARGO_TARGET_DIR: target,
  });
  const executable = join(generated, "garden-desk-hyper-v-setup.exe");
  copyFileSync(join(target, "release", "garden-desk-hyper-v-setup.exe"), executable);
  signExecutable(executable);
} else {
  console.log("The Windows Hyper-V setup helper is not built on this platform.");
}

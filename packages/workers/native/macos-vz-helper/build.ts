import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

function run(command: string, args: string[], environment?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    env: environment ?? process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
}

if (process.platform === "darwin") {
  const root = join(process.cwd(), "packages/workers/native/macos-vz-helper");
  const generated = join(root, ".generated");
  const moduleCache = join(generated, "module-cache");
  rmSync(moduleCache, { force: true, recursive: true });
  mkdirSync(moduleCache, { recursive: true });
  const executable = join(generated, "vault-vz-helper");
  run(
    "swiftc",
    [
      join(root, "Sources/vault-vz-helper/main.swift"),
      "-parse-as-library",
      "-framework",
      "Virtualization",
      "-module-cache-path",
      moduleCache,
      "-O",
      "-o",
      executable,
    ],
    { ...process.env, CLANG_MODULE_CACHE_PATH: moduleCache },
  );
  run("codesign", [
    "--force",
    "--sign",
    "-",
    "--entitlements",
    join(root, "vault-vz-helper.entitlements.plist"),
    executable,
  ]);
  run("codesign", ["--verify", "--strict", executable]);
} else {
  console.log("macOS helper build is not required on this platform stage.");
}

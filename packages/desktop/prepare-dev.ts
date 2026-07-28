import { spawnSync } from "node:child_process";
import { lstat, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const resourcesRoot = join(desktopRoot, "src-tauri", "resources", "core");
const requiredOutputs = [
  join(resourcesRoot, "resource-manifest.json"),
  join(resourcesRoot, "models", "gemma-4-12b-it-qat-q4_0.gguf"),
  join(resourcesRoot, "models", "installed-models.json"),
  join(resourcesRoot, "inference", "worker.mjs"),
  join(resourcesRoot, "inference", "node.exe"),
  join(resourcesRoot, "inference", "vault-appcontainer-launcher.exe"),
  join(resourcesRoot, "inference", "cublas64_13.dll"),
  join(resourcesRoot, "inference", "cublasLt64_13.dll"),
  join(resourcesRoot, "inference", "node_modules", "node-llama-cpp", "package.json"),
  join(
    resourcesRoot,
    "inference",
    "node_modules",
    "@node-llama-cpp",
    "win-x64-cuda",
    "package.json",
  ),
  join(
    resourcesRoot,
    "inference",
    "node_modules",
    "@node-llama-cpp",
    "win-x64-cuda-ext",
    "package.json",
  ),
  join(
    resourcesRoot,
    "inference",
    "node_modules",
    "@node-llama-cpp",
    "win-x64-vulkan",
    "package.json",
  ),
  join(resourcesRoot, "workers", "vault-hcs-helper.exe"),
  join(resourcesRoot, "workers", "images", "agent", "manifest.json"),
  join(resourcesRoot, "workers", "images", ".generated", "agent", "artifacts", "x86_64", "bzImage"),
  join(
    resourcesRoot,
    "workers",
    "images",
    ".generated",
    "agent",
    "artifacts",
    "x86_64",
    "rootfs.cpio",
  ),
  join(desktopRoot, "src-tauri", "binaries", "vault-core-x86_64-pc-windows-msvc.exe"),
];
const inputRoots = [
  join(repositoryRoot, "pnpm-lock.yaml"),
  join(repositoryRoot, "patches"),
  join(repositoryRoot, "packages", "shared", "src"),
  join(repositoryRoot, "packages", "core", "package.json"),
  join(repositoryRoot, "packages", "core", "src"),
  join(repositoryRoot, "packages", "core", "native", "windows-pipe-guard", "build.ts"),
  join(repositoryRoot, "packages", "core", "native", "windows-pipe-guard", "Cargo.lock"),
  join(repositoryRoot, "packages", "core", "native", "windows-pipe-guard", "Cargo.toml"),
  join(repositoryRoot, "packages", "core", "native", "windows-pipe-guard", "src"),
  join(repositoryRoot, "packages", "workers", "package.json"),
  join(repositoryRoot, "packages", "workers", "src"),
  join(repositoryRoot, "packages", "workers", "native", "windows-hcs-helper", "build.ts"),
  join(repositoryRoot, "packages", "workers", "native", "windows-hcs-helper", "Cargo.lock"),
  join(repositoryRoot, "packages", "workers", "native", "windows-hcs-helper", "Cargo.toml"),
  join(repositoryRoot, "packages", "workers", "native", "windows-hcs-helper", "src"),
  join(
    repositoryRoot,
    "packages",
    "workers",
    "native",
    "windows-appcontainer-launcher",
    "build.ts",
  ),
  join(
    repositoryRoot,
    "packages",
    "workers",
    "native",
    "windows-appcontainer-launcher",
    "Cargo.lock",
  ),
  join(
    repositoryRoot,
    "packages",
    "workers",
    "native",
    "windows-appcontainer-launcher",
    "Cargo.toml",
  ),
  join(repositoryRoot, "packages", "workers", "native", "windows-appcontainer-launcher", "src"),
  join(repositoryRoot, "packages", "workers", "images", "build.ts"),
  join(repositoryRoot, "packages", "workers", "images", "capabilities.ts"),
  join(repositoryRoot, "packages", "workers", "images", "manifest.json"),
  join(repositoryRoot, "packages", "workers", "images", "agent"),
  join(repositoryRoot, "packages", "workers", "images", "buildroot-external"),
  join(desktopRoot, "package.json"),
  join(desktopRoot, "build-sidecar.ts"),
  join(desktopRoot, "package-resources.ts"),
  join(desktopRoot, "package-compliance.ts"),
  join(desktopRoot, "runtime-packages.ts"),
  join(desktopRoot, "windows-runtime-assets.json"),
  join(desktopRoot, "windows-runtime-assets.ts"),
];

async function newestModifiedAt(path: string): Promise<number> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory()) return metadata.mtimeMs;
  const children = await readdir(path);
  const modified = await Promise.all(children.map((name) => newestModifiedAt(join(path, name))));
  return Math.max(metadata.mtimeMs, ...modified);
}

async function resourcesAreCurrent(): Promise<boolean> {
  try {
    const [manifest, latestInput] = await Promise.all([
      stat(requiredOutputs[0] as string),
      Promise.all(inputRoots.map(newestModifiedAt)).then((values) => Math.max(...values)),
      ...requiredOutputs.slice(1).map(stat),
    ]);
    return manifest.mtimeMs >= latestInput;
  } catch {
    return false;
  }
}

if (await resourcesAreCurrent()) {
  console.log("Vault Desk development resources are current.");
} else {
  console.log("Preparing Vault Desk offline development resources; this can take a few minutes.");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(desktopRoot, "build-sidecar.ts")],
    { cwd: desktopRoot, stdio: "inherit" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`Development resource preparation exited ${result.status}.`);
}

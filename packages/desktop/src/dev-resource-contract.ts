import { join } from "node:path";

interface DevelopmentResourceContract {
  inputRoots: string[];
  requiredOutputs: string[];
}

function commonInputs(desktopRoot: string, repositoryRoot: string): string[] {
  return [
    join(repositoryRoot, "pnpm-lock.yaml"),
    join(repositoryRoot, "patches"),
    join(repositoryRoot, "packages", "shared", "src"),
    join(repositoryRoot, "packages", "core", "package.json"),
    join(repositoryRoot, "packages", "core", "src"),
    join(repositoryRoot, "packages", "workers", "package.json"),
    join(repositoryRoot, "packages", "workers", "src"),
    join(repositoryRoot, "packages", "workers", "images", "build.ts"),
    join(repositoryRoot, "packages", "workers", "images", "capabilities.ts"),
    join(repositoryRoot, "packages", "workers", "images", "manifest.json"),
    join(repositoryRoot, "packages", "workers", "images", "agent"),
    join(repositoryRoot, "packages", "workers", "images", "buildroot-external"),
    join(desktopRoot, "package.json"),
    join(desktopRoot, "build-sidecar.ts"),
    join(desktopRoot, "build-signing.ts"),
    join(desktopRoot, "package-resources.ts"),
    join(desktopRoot, "package-compliance.ts"),
    join(desktopRoot, "runtime-packages.ts"),
    join(desktopRoot, "src", "dev-resource-progress.ts"),
    join(desktopRoot, "src", "package-resource-contract.ts"),
    join(desktopRoot, "src", "runtime-package-contract.ts"),
  ];
}

function commonOutputs(resourcesRoot: string): string[] {
  return [
    join(resourcesRoot, "resource-manifest.json"),
    join(resourcesRoot, "models", "gemma-4-12b-it-qat-q4_0.gguf"),
    join(resourcesRoot, "models", "installed-models.json"),
    join(resourcesRoot, "inference", "worker.mjs"),
    join(resourcesRoot, "inference", "node_modules", "node-llama-cpp", "package.json"),
    join(resourcesRoot, "workers", "images", "agent", "manifest.json"),
  ];
}

function guestOutputs(resourcesRoot: string, architecture: string, kernel: string): string[] {
  const artifactsRoot = join(
    resourcesRoot,
    "workers",
    "images",
    ".generated",
    "agent",
    "artifacts",
    architecture,
  );
  return [join(artifactsRoot, kernel), join(artifactsRoot, "rootfs.cpio")];
}

function rustHelperInputs(root: string): string[] {
  return [
    join(root, "build.ts"),
    join(root, "Cargo.lock"),
    join(root, "Cargo.toml"),
    join(root, "src"),
  ];
}

function macHelperInputs(root: string): string[] {
  return [
    join(root, "build.ts"),
    join(root, "Package.resolved"),
    join(root, "Package.swift"),
    join(root, "Sources"),
    join(root, "vault-vz-helper.entitlements.plist"),
  ];
}

function windowsContract(
  desktopRoot: string,
  repositoryRoot: string,
  resourcesRoot: string,
): DevelopmentResourceContract {
  return {
    inputRoots: [
      ...commonInputs(desktopRoot, repositoryRoot),
      ...rustHelperInputs(join(repositoryRoot, "packages", "core", "native", "windows-pipe-guard")),
      ...rustHelperInputs(
        join(repositoryRoot, "packages", "workers", "native", "windows-hcs-helper"),
      ),
      ...rustHelperInputs(
        join(repositoryRoot, "packages", "workers", "native", "windows-appcontainer-launcher"),
      ),
      join(desktopRoot, "windows-runtime-assets.json"),
      join(desktopRoot, "windows-runtime-assets.ts"),
    ],
    requiredOutputs: [
      ...commonOutputs(resourcesRoot),
      join(resourcesRoot, "inference", "node.exe"),
      join(resourcesRoot, "inference", "vault-appcontainer-launcher.exe"),
      join(resourcesRoot, "inference", "cublas64_13.dll"),
      join(resourcesRoot, "inference", "cublasLt64_13.dll"),
      ...["win-x64-cuda", "win-x64-cuda-ext", "win-x64-vulkan"].map((name) =>
        join(resourcesRoot, "inference", "node_modules", "@node-llama-cpp", name, "package.json"),
      ),
      join(resourcesRoot, "workers", "vault-hcs-helper.exe"),
      ...guestOutputs(resourcesRoot, "x86_64", "bzImage"),
      join(desktopRoot, "src-tauri", "binaries", "vault-core-x86_64-pc-windows-msvc.exe"),
    ],
  };
}

function macContract(
  desktopRoot: string,
  repositoryRoot: string,
  resourcesRoot: string,
): DevelopmentResourceContract {
  return {
    inputRoots: [
      ...commonInputs(desktopRoot, repositoryRoot),
      ...macHelperInputs(join(repositoryRoot, "packages", "workers", "native", "macos-vz-helper")),
    ],
    requiredOutputs: [
      ...commonOutputs(resourcesRoot),
      join(resourcesRoot, "inference", "node"),
      join(
        resourcesRoot,
        "inference",
        "node_modules",
        "@node-llama-cpp",
        "mac-arm64-metal",
        "package.json",
      ),
      join(resourcesRoot, "workers", "vault-vz-helper"),
      ...guestOutputs(resourcesRoot, "aarch64", "Image"),
      join(desktopRoot, "src-tauri", "binaries", "vault-core-aarch64-apple-darwin"),
    ],
  };
}

export function developmentResourceContract(
  desktopRoot: string,
  repositoryRoot: string,
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): DevelopmentResourceContract {
  const resourcesRoot = join(desktopRoot, "src-tauri", "resources", "core");
  if (platform === "win32" && architecture === "x64") {
    return windowsContract(desktopRoot, repositoryRoot, resourcesRoot);
  }
  if (platform === "darwin" && architecture === "arm64") {
    return macContract(desktopRoot, repositoryRoot, resourcesRoot);
  }
  throw new Error("Unsupported Vault Desk desktop development target.");
}

import { join } from "node:path";

interface DevelopmentResourceContract {
  inputRoots: string[];
  requiredOutputs: string[];
}

function modelInputs(repositoryRoot: string): string[] {
  const root = join(repositoryRoot, "packages", "eval", ".generated", "models");
  return [join(root, "qwen3.8-27b-ud-iq4_xs.gguf"), join(root, "qwen3.8-27b-mmproj-f16.gguf")];
}

function commonInputs(desktopRoot: string, repositoryRoot: string): string[] {
  return [
    join(repositoryRoot, "pnpm-lock.yaml"),
    join(repositoryRoot, "assets", "inference-runtime.json"),
    join(repositoryRoot, "assets", "licenses"),
    join(repositoryRoot, "packages", "shared", "src"),
    join(repositoryRoot, "packages", "core", "package.json"),
    join(repositoryRoot, "packages", "core", "src"),
    join(repositoryRoot, "prompts"),
    join(repositoryRoot, "packages", "workers", "package.json"),
    join(repositoryRoot, "packages", "workers", "src"),
    join(repositoryRoot, "packages", "workers", "images", "build.ts"),
    join(repositoryRoot, "packages", "workers", "images", "capabilities.ts"),
    join(repositoryRoot, "packages", "workers", "images", "manifest.json"),
    join(repositoryRoot, "packages", "workers", "images", "agent"),
    join(repositoryRoot, "packages", "workers", "images", "buildroot-external"),
    ...modelInputs(repositoryRoot),
    join(desktopRoot, "package.json"),
    join(desktopRoot, "build-sidecar.ts"),
    join(desktopRoot, "build-signing.ts"),
    join(desktopRoot, "package-resources.ts"),
    join(desktopRoot, "package-image-resources.ts"),
    join(desktopRoot, "package-compliance.ts"),
    join(desktopRoot, "windows-setup-resource.ts"),
    join(desktopRoot, "src", "dev-resource-progress.ts"),
    join(desktopRoot, "src", "package-model-contract.ts"),
    join(desktopRoot, "src", "package-resource-contract.ts"),
    join(desktopRoot, "src", "resource-hashes.ts"),
    join(desktopRoot, "src", "runtime-package-contract.ts"),
    join(desktopRoot, "src", "windows-signing-mode.ts"),
  ];
}

function commonOutputs(resourcesRoot: string): string[] {
  return [
    join(resourcesRoot, "resource-manifest.json"),
    join(resourcesRoot, "models", "installed-models.json"),
    join(resourcesRoot, "licenses", "llama.cpp-LICENSE.txt"),
    join(resourcesRoot, "workers", "images", "agent", "manifest.json"),
    join(resourcesRoot, "prompts", "agents", "primary.md"),
    join(resourcesRoot, "prompts", "skills", "terminal-commands", "SKILL.md"),
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
    join(root, "garden-desk-vz-helper.entitlements.plist"),
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
      ...rustHelperInputs(join(desktopRoot, "native", "windows-hyper-v-setup")),
      join(repositoryRoot, "packages", "eval", ".generated", "inference", "windows-cuda-x64"),
      join(repositoryRoot, "packages", "eval", ".generated", "inference", "windows-vulkan-x64"),
    ],
    requiredOutputs: [
      ...commonOutputs(resourcesRoot),
      join(resourcesRoot, "licenses", "cuda-EULA.html"),
      join(resourcesRoot, "licenses", "llvm-OpenMP-LICENSE.txt"),
      join(resourcesRoot, "inference", "garden-desk-appcontainer-launcher.exe"),
      ...["windows-cuda-x64", "windows-vulkan-x64"].map((name) =>
        join(resourcesRoot, "inference", name, "llama-server.exe"),
      ),
      join(resourcesRoot, "workers", "garden-desk-hcs-helper.exe"),
      join(resourcesRoot, "windows", "garden-desk-hyper-v-setup.exe"),
      ...guestOutputs(resourcesRoot, "x86_64", "bzImage"),
      join(desktopRoot, "src-tauri", "binaries", "garden-desk-core-x86_64-pc-windows-msvc.exe"),
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
      join(repositoryRoot, "packages", "eval", ".generated", "inference", "macos-arm64"),
    ],
    requiredOutputs: [
      ...commonOutputs(resourcesRoot),
      join(resourcesRoot, "inference", "macos-arm64", "llama-server"),
      join(resourcesRoot, "workers", "garden-desk-vz-helper"),
      ...guestOutputs(resourcesRoot, "aarch64", "Image"),
      join(desktopRoot, "src-tauri", "binaries", "garden-desk-core-aarch64-apple-darwin"),
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
  throw new Error("Unsupported Garden Desk desktop development target.");
}

import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";

export interface WindowsInferencePaths {
  inferenceHelperPath: string;
  inferenceRuntimePath: string;
  workerEntryPath: string;
  visionRuntimePath: string;
}

/**
 * The Windows worker must run through the packaged CUDA runtime and its adjacent
 * redistributables. The development Node runtime cannot load them and misreads
 * VRAM as a multi-adapter aggregate, so physical evidence always uses these
 * packaged resources. The completed package is preferred; `pnpm
 * desktop:build-sidecar` stages the same verified resources for headless runs.
 */
const inferenceRoots = [
  "packages/desktop/src-tauri/target/release/bundle/windows/Garden Desk/resources/core/inference",
  "packages/desktop/src-tauri/resources/core/inference",
];
export async function windowsInferencePaths(): Promise<WindowsInferencePaths> {
  for (const relative of inferenceRoots) {
    const root = join(process.cwd(), relative);
    try {
      await Promise.all([
        stat(join(root, "windows-cuda-x64", "llama-server.exe")),
        stat(join(root, "windows-vulkan-x64", "llama-server.exe")),
      ]);
      return {
        workerEntryPath: "",
        inferenceHelperPath: join(root, "garden-desk-appcontainer-launcher.exe"),
        inferenceRuntimePath: join(root, "windows-cuda-x64", "llama-server.exe"),
        visionRuntimePath: join(root, "windows-cuda-x64", "llama-server.exe"),
      };
    } catch {
      // Try the next staged inference root.
    }
  }
  throw new Error(
    "Build the packaged Windows inference resources with `pnpm desktop:build-sidecar` before running this gate.",
  );
}

export async function developmentWindowsInferencePaths(): Promise<WindowsInferencePaths> {
  const production = await windowsInferencePaths();
  return {
    ...production,
    workerEntryPath: developmentInferenceWorkerEntryPath(
      "win32",
      dirname(production.workerEntryPath),
    ),
  };
}

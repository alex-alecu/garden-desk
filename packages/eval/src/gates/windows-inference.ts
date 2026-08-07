import { stat } from "node:fs/promises";
import { join } from "node:path";

export interface WindowsInferencePaths {
  inferenceHelperPath: string;
  inferenceRuntimePath: string;
  workerEntryPath: string;
}

/**
 * The Windows worker must run through the packaged CUDA runtime and its adjacent
 * redistributables. The development Node runtime cannot load them and misreads
 * VRAM as a multi-adapter aggregate, so physical evidence always uses these
 * packaged resources. The completed package is preferred; `pnpm
 * desktop:build-sidecar` stages the same verified resources for headless runs.
 */
const inferenceRoots = [
  "packages/desktop/src-tauri/target/release/bundle/windows/Vault Desk/resources/core/inference",
  "packages/desktop/src-tauri/resources/core/inference",
];

export async function windowsInferencePaths(): Promise<WindowsInferencePaths> {
  for (const relative of inferenceRoots) {
    const root = join(process.cwd(), relative);
    try {
      await stat(join(root, "worker.mjs"));
      return {
        workerEntryPath: join(root, "worker.mjs"),
        inferenceHelperPath: join(root, "vault-appcontainer-launcher.exe"),
        inferenceRuntimePath: join(root, "node.exe"),
      };
    } catch {
      // Try the next staged inference root.
    }
  }
  throw new Error(
    "Build the packaged Windows inference resources with `pnpm desktop:build-sidecar` before running this gate.",
  );
}

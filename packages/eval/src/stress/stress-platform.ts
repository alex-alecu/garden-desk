import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface StressPlatform {
  helper: string;
  inference?: {
    inferenceHelperPath: string;
    inferenceRuntimePath: string;
    workerEntryPath: string;
  };
}

const repositoryRoot = process.cwd();

/**
 * The Windows worker must run through the packaged CUDA runtime; the development
 * Node runtime cannot load the adjacent redistributables and misreads VRAM.
 */
const windowsInferenceRoots = [
  join(
    repositoryRoot,
    "packages/desktop/src-tauri/target/release/bundle/windows/Vault Desk/resources/core/inference",
  ),
  join(repositoryRoot, "packages/desktop/src-tauri/resources/core/inference"),
];

async function windowsInferenceRoot(): Promise<string> {
  for (const root of windowsInferenceRoots) {
    try {
      await stat(join(root, "worker.mjs"));
      return root;
    } catch {
      // Try the next staged inference root.
    }
  }
  throw new Error(
    "Build the packaged Windows inference resources with `pnpm desktop:build-sidecar` before running the stress suite.",
  );
}

export async function stressPlatform(): Promise<StressPlatform> {
  if (process.platform === "win32") {
    const inferenceRoot = await windowsInferenceRoot();
    return {
      helper: join(
        repositoryRoot,
        "packages/workers/native/windows-hcs-helper/.generated/vault-hcs-helper.exe",
      ),
      inference: {
        workerEntryPath: join(inferenceRoot, "worker.mjs"),
        inferenceHelperPath: join(inferenceRoot, "vault-appcontainer-launcher.exe"),
        inferenceRuntimePath: join(inferenceRoot, "node.exe"),
      },
    };
  }
  return {
    helper: join(
      repositoryRoot,
      "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper",
    ),
  };
}

export function requireStressPlatform(): void {
  const supported =
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "win32" && process.arch === "x64");
  if (!supported) {
    throw new Error("The M3 stress suites require physical Apple silicon or Windows x64.");
  }
}

/**
 * macOS Unix-socket paths must stay within their length limit, so the macOS
 * fixture root stays directly under `/tmp` instead of the longer default.
 */
export async function createStressRoot(prefix: string): Promise<string> {
  return process.platform === "win32"
    ? mkdtemp(join(tmpdir(), `${prefix}-`))
    : mkdtemp(`/tmp/${prefix}-`);
}

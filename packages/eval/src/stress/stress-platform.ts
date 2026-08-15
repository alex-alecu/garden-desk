import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsInferencePaths } from "../gates/windows-inference.js";

export interface StressPlatform {
  helper: string;
  visionRuntimePath: string;
  inference?: {
    inferenceHelperPath: string;
    inferenceRuntimePath: string;
    workerEntryPath: string;
  };
}

const repositoryRoot = process.cwd();

export async function stressPlatform(): Promise<StressPlatform> {
  if (process.platform === "win32") {
    return {
      helper: join(
        repositoryRoot,
        "packages/workers/native/windows-hcs-helper/.generated/vault-hcs-helper.exe",
      ),
      visionRuntimePath: join(
        repositoryRoot,
        "packages/eval/.generated/vision/windows-vulkan-x64/llama-mtmd-cli.exe",
      ),
      inference: await windowsInferencePaths(),
    };
  }
  return {
    helper: join(
      repositoryRoot,
      "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper",
    ),
    visionRuntimePath: join(
      repositoryRoot,
      "packages/eval/.generated/vision/macos-arm64/llama-mtmd-cli",
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

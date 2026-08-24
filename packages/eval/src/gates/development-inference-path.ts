import { join } from "node:path";

const repositoryRoot = process.cwd();

export function developmentInferenceWorkerEntryPath(
  platform: NodeJS.Platform = process.platform,
  windowsInferenceRoot?: string,
): string {
  if (platform === "win32") {
    if (windowsInferenceRoot === undefined)
      throw new Error("Windows inference resources are required.");
    return join(windowsInferenceRoot, ".generated", "development-inference", "worker.mjs");
  }
  return join(
    repositoryRoot,
    "packages",
    "workers",
    ".generated",
    "development-inference",
    "worker.mjs",
  );
}

import { spawnSync } from "node:child_process";
import { lstat, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentResourceContract } from "./src/dev-resource-contract.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const { inputRoots, requiredOutputs } = developmentResourceContract(desktopRoot, repositoryRoot);

console.log(
  "[Vault Desk startup] Checking offline desktop resources before starting the frontend.",
);

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
  console.log("[Vault Desk startup] Offline resources are current; starting the frontend.");
} else {
  console.log(
    "[Vault Desk startup] Offline resources changed; rebuilding the self-contained development package.",
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(desktopRoot, "build-sidecar.ts")],
    { cwd: desktopRoot, stdio: "inherit" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0)
    throw new Error(`Development resource preparation exited ${result.status}.`);
  console.log("[Vault Desk startup] Offline resources are ready; starting the frontend.");
}

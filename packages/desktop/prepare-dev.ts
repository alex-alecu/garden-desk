import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSidecar } from "./build-sidecar.js";
import { prepareDevelopmentModelOutput } from "./package-output-cleanup.js";
import { developmentResourceContract } from "./src/dev-resource-contract.js";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = resolve(desktopRoot, "../..");
const { inputRoots, requiredOutputs } = developmentResourceContract(desktopRoot, repositoryRoot);

console.log(
  "[Garden Desk startup] Checking offline desktop resources before starting the frontend.",
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
    const record = JSON.parse(
      await readFile(join(desktopRoot, ".generated", "sidecar", "build-record.json"), "utf8"),
    ) as { buildMode?: unknown };
    return manifest.mtimeMs >= latestInput && record.buildMode === "development";
  } catch {
    return false;
  }
}

const resourcesCurrent = await resourcesAreCurrent();
if (!resourcesCurrent) {
  console.log(
    "[Garden Desk startup] Offline resources changed; rebuilding the self-contained development package.",
  );
  await buildSidecar("development");
}
await prepareDevelopmentModelOutput(desktopRoot, repositoryRoot);
console.log(
  resourcesCurrent
    ? "[Garden Desk startup] Offline resources are current; starting the frontend."
    : "[Garden Desk startup] Offline resources are ready; starting the frontend.",
);

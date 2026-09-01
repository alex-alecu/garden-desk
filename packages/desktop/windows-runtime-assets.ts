import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

interface AssetFile {
  source: string;
  destination: string;
  byteLength: number;
  sha256: string;
}

interface AssetManifest {
  archive: { file: string; byteLength: number; sha256: string };
  extractedRoot: string;
  files: AssetFile[];
}

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));
const generatedRoot = join(desktopRoot, ".generated", "nvidia");

async function sha256(path: string): Promise<string> {
  const digest = createHash("sha256");
  await new Promise<void>((accept, reject) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => digest.update(chunk));
    input.once("error", reject);
    input.once("end", accept);
  });
  return digest.digest("hex");
}

async function verify(path: string, expected: { byteLength: number; sha256: string }) {
  if ((await stat(path)).size !== expected.byteLength || (await sha256(path)) !== expected.sha256) {
    throw new Error(`Windows runtime asset verification failed: ${path}`);
  }
}

function extract(archive: string, destination: string): void {
  const powershell = join(
    process.env.WINDIR ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = spawnSync(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:GARDEN_DESK_ARCHIVE -DestinationPath $env:GARDEN_DESK_DESTINATION -Force",
    ],
    {
      env: { ...process.env, GARDEN_DESK_ARCHIVE: archive, GARDEN_DESK_DESTINATION: destination },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || "NVIDIA archive extraction failed.");
}

export async function installWindowsCudaAssets(inferenceRoot: string) {
  const manifest = JSON.parse(
    await readFile(join(desktopRoot, "windows-runtime-assets.json"), "utf8"),
  ) as AssetManifest;
  const archive = join(generatedRoot, manifest.archive.file);
  await verify(archive, manifest.archive);
  const extracted = join(generatedRoot, manifest.extractedRoot);
  try {
    await stat(join(extracted, manifest.files[0]?.source ?? ""));
  } catch {
    extract(archive, join(generatedRoot, manifest.extractedRoot.split("/")[0] ?? ""));
  }
  const hashes: Record<string, string> = {};
  for (const file of manifest.files) {
    const source = join(extracted, ...file.source.split("/"));
    await verify(source, file);
    const destination = join(inferenceRoot, file.destination);
    await copyFile(source, destination);
    hashes[file.destination] = await sha256(destination);
  }
  return hashes;
}

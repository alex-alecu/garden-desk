import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

interface RuntimeArchive {
  archive: string;
  byteLength: number;
  files: Record<string, string>;
  sha256: string;
  url: string;
}

interface PlatformRuntime extends RuntimeArchive {
  dependencies?: RuntimeArchive[];
  executable: string;
}

interface InferenceManifest {
  platforms: Record<string, PlatformRuntime>;
  revision: string;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function platformKey(): string {
  const explicit = argument("--platform");
  if (explicit !== undefined) return explicit;
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-cuda-x64";
  throw new Error("unsupported_inference_platform");
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function archivePath(path: string): string {
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    normalize(path) !== path ||
    path.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("inference_archive_path_invalid");
  }
  return path;
}

function targetName(path: string): string {
  if (path.includes("\0") || path !== basename(path)) {
    throw new Error("inference_target_name_invalid");
  }
  return path;
}

function extract(archive: string, destination: string, files: string[]): void {
  const result = spawnSync("tar", ["-xf", archive, "-C", destination, "--", ...files], {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || "inference_archive_extract_failed");
}

async function fetchArchive(asset: RuntimeArchive, destination: string): Promise<void> {
  const response = await fetch(asset.url, {
    redirect: "follow",
    signal: AbortSignal.timeout(600_000),
  });
  if (!response.ok || response.body === null)
    throw new Error(`inference_download_failed_${response.status}`);
  await pipeline(
    Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
    (await import("node:fs")).createWriteStream(destination, { mode: 0o600 }),
  );
  const metadata = await stat(destination);
  if (metadata.size !== asset.byteLength || (await sha256(destination)) !== asset.sha256) {
    throw new Error("inference_archive_integrity_failed");
  }
}

async function stageArchive(input: {
  asset: RuntimeArchive;
  archive: string;
  extracted: string;
  installed: Set<string>;
  staged: string;
}): Promise<void> {
  const { asset, archive, extracted, installed, staged } = input;
  const entries = Object.entries(asset.files).map(
    ([source, target]) => [archivePath(source), targetName(target)] as const,
  );
  for (const [, target] of entries) {
    if (installed.has(target)) throw new Error("inference_target_name_duplicate");
    installed.add(target);
  }
  await mkdir(extracted);
  extract(
    archive,
    extracted,
    entries.map(([source]) => source),
  );
  for (const [source, target] of entries) {
    const path = join(extracted, source);
    const fromRoot = relative(extracted, path);
    const metadata = await lstat(path);
    if (isAbsolute(fromRoot) || fromRoot.startsWith("..") || !metadata.isFile()) {
      throw new Error("inference_archive_entry_invalid");
    }
    await copyFile(path, join(staged, target));
  }
}

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const manifest = JSON.parse(
  await readFile(join(repositoryRoot, "assets/inference-runtime.json"), "utf8"),
) as InferenceManifest;
const key = platformKey();
const runtime = manifest.platforms[key];
if (runtime === undefined) throw new Error(`Unknown inference platform: ${key}`);
const destination = join(repositoryRoot, "packages/eval/.generated/inference", key);
const temporaryRoot = await mkdtemp(join(tmpdir(), "garden-desk-inference-fetch-"));
const staged = join(dirname(destination), `.${key}-${process.pid}`);
try {
  await rm(staged, { recursive: true, force: true });
  await mkdir(staged, { recursive: true, mode: 0o700 });
  const installed = new Set<string>();
  const archives = [runtime, ...(runtime.dependencies ?? [])];
  for (const [index, asset] of archives.entries()) {
    const archive = join(temporaryRoot, `${index}-${targetName(asset.archive)}`);
    const extracted = join(temporaryRoot, `extracted-${index}`);
    await fetchArchive(asset, archive);
    await stageArchive({ asset, archive, extracted, installed, staged });
  }
  await chmod(join(staged, runtime.executable), 0o755);
  await rm(destination, { recursive: true, force: true });
  await rename(staged, destination);
  console.log(JSON.stringify({ destination, platform: key, revision: manifest.revision }));
} finally {
  await rm(staged, { recursive: true, force: true });
  await rm(temporaryRoot, { recursive: true, force: true });
}

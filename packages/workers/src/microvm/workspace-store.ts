import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type AgentWorkspaceDelta,
  type AgentWorkspaceEntry,
  AgentWorkspacePathSchema,
} from "@vault/shared";

const MAX_WORKSPACE_BYTES = 128 * 1024 * 1024;
const MANIFEST_VERSION = 1;

interface StoredEntry {
  kind: "directory" | "file";
  path: string;
  contentHash?: string;
  byteLength?: number;
}

interface StoredManifest {
  version: 1;
  entries: StoredEntry[];
}

function sessionName(sessionId: string): string {
  if (!/^[a-f0-9-]{36}$/iu.test(sessionId)) throw new Error("invalid_session_id");
  return sessionId.toLowerCase();
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const state = await lstat(path);
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    (process.getuid !== undefined && state.uid !== process.getuid())
  ) {
    throw new Error("workspace_directory_unsafe");
  }
  await chmod(path, 0o700);
}

function decodeFile(entry: Extract<AgentWorkspaceEntry, { kind: "file" }>): Buffer {
  AgentWorkspacePathSchema.parse(entry.path);
  const bytes = Buffer.from(entry.bytesBase64, "base64");
  if (bytes.toString("base64") !== entry.bytesBase64) throw new Error("workspace_content_invalid");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.contentHash) throw new Error("workspace_content_hash_mismatch");
  return bytes;
}

async function readManifest(path: string): Promise<StoredManifest | undefined> {
  try {
    const state = await lstat(path);
    if (!state.isFile() || state.isSymbolicLink()) throw new Error("workspace_manifest_invalid");
    const parsed = JSON.parse(await readFile(path, "utf8")) as StoredManifest;
    if (parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.entries)) {
      throw new Error("workspace_manifest_invalid");
    }
    validateManifest(parsed.entries);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function loadEntry(root: string, entry: StoredEntry): Promise<AgentWorkspaceEntry> {
  AgentWorkspacePathSchema.parse(entry.path);
  if (entry.kind === "directory") return { kind: "directory", path: entry.path };
  if (typeof entry.contentHash !== "string" || typeof entry.byteLength !== "number") {
    throw new Error("workspace_manifest_invalid");
  }
  const path = join(root, "blobs", entry.contentHash);
  const state = await lstat(path);
  if (!state.isFile() || state.isSymbolicLink() || state.size !== entry.byteLength) {
    throw new Error("workspace_blob_invalid");
  }
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== entry.contentHash) {
    throw new Error("workspace_blob_invalid");
  }
  return {
    kind: "file",
    path: entry.path,
    contentHash: entry.contentHash,
    bytesBase64: bytes.toString("base64"),
  };
}

async function ensureBlob(root: string, contentHash: string, bytes: Buffer): Promise<void> {
  const blob = join(root, "blobs", contentHash);
  try {
    const existing = await lstat(blob);
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.size !== bytes.byteLength ||
      createHash("sha256")
        .update(await readFile(blob))
        .digest("hex") !== contentHash
    ) {
      throw new Error("workspace_blob_invalid");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await atomicWrite(blob, bytes);
  }
}

async function storeEntry(root: string, entry: AgentWorkspaceEntry): Promise<StoredEntry> {
  AgentWorkspacePathSchema.parse(entry.path);
  if (entry.kind === "directory") return { kind: "directory", path: entry.path };
  const bytes = decodeFile(entry);
  await ensureBlob(root, entry.contentHash, bytes);
  return {
    kind: "file",
    path: entry.path,
    contentHash: entry.contentHash,
    byteLength: bytes.byteLength,
  };
}

function validateEntry(entry: StoredEntry, paths: Set<string>): void {
  if ((entry.kind !== "file" && entry.kind !== "directory") || paths.has(entry.path)) {
    throw new Error("workspace_manifest_invalid");
  }
  AgentWorkspacePathSchema.parse(entry.path);
  paths.add(entry.path);
}

function validateManifest(entries: StoredEntry[]): void {
  const paths = new Set<string>();
  for (const entry of entries) {
    validateEntry(entry, paths);
  }
  const files = new Set(
    entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
  );
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      if (files.has(parts.slice(0, length).join("/")))
        throw new Error("workspace_manifest_invalid");
    }
  }
}

async function retainedBlobHashes(root: string): Promise<Set<string>> {
  const retained = new Set<string>();
  for (const name of await readdir(join(root, "manifests"))) {
    if (!name.endsWith(".json")) continue;
    const manifest = await readManifest(join(root, "manifests", name));
    for (const entry of manifest?.entries ?? []) {
      if (entry.contentHash !== undefined) retained.add(entry.contentHash);
    }
  }
  return retained;
}

async function removeUnreferencedBlobs(root: string, retained: Set<string>): Promise<void> {
  for (const contentHash of await readdir(join(root, "blobs"))) {
    if (/^[a-f0-9]{64}$/u.test(contentHash) && !retained.has(contentHash)) {
      await rm(join(root, "blobs", contentHash), { force: true });
    }
  }
}

export class AgentWorkspaceStore {
  private serial: Promise<void> = Promise.resolve();

  private constructor(private readonly root: string) {}

  static async create(root: string): Promise<AgentWorkspaceStore> {
    await secureDirectory(root);
    await secureDirectory(join(root, "blobs"));
    await secureDirectory(join(root, "manifests"));
    return new AgentWorkspaceStore(root);
  }

  async load(sessionId: string): Promise<AgentWorkspaceEntry[]> {
    const path = join(this.root, "manifests", `${sessionName(sessionId)}.json`);
    const parsed = await readManifest(path);
    if (parsed === undefined) return [];
    const output: AgentWorkspaceEntry[] = [];
    let total = 0;
    for (const entry of parsed.entries) {
      const loaded = await loadEntry(this.root, entry);
      total += loaded.kind === "file" ? Buffer.byteLength(loaded.bytesBase64, "base64") : 0;
      if (total > MAX_WORKSPACE_BYTES) throw new Error("workspace_quota_exceeded");
      output.push(loaded);
    }
    return output;
  }

  async readFile(sessionId: string, workspacePath: string): Promise<Buffer | undefined> {
    AgentWorkspacePathSchema.parse(workspacePath);
    return await this.exclusive(async () => {
      const manifest = await readManifest(
        join(this.root, "manifests", `${sessionName(sessionId)}.json`),
      );
      const entry = manifest?.entries.find((item) => item.path === workspacePath);
      if (entry?.kind !== "file") return undefined;
      const loaded = await loadEntry(this.root, entry);
      if (loaded.kind !== "file") throw new Error("workspace_manifest_invalid");
      return Buffer.from(loaded.bytesBase64, "base64");
    });
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.serial;
    let release = (): void => undefined;
    this.serial = new Promise<void>((accept) => {
      release = accept;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private mutate(operation: () => Promise<void>): Promise<void> {
    return this.exclusive(operation);
  }

  private async commitUnlocked(sessionId: string, entries: AgentWorkspaceEntry[]): Promise<void> {
    const paths = new Set<string>();
    const stored: StoredEntry[] = [];
    let total = 0;
    for (const entry of entries) {
      if (paths.has(entry.path)) throw new Error("workspace_manifest_invalid");
      paths.add(entry.path);
      const item = await storeEntry(this.root, entry);
      total += item.byteLength ?? 0;
      if (total > MAX_WORKSPACE_BYTES) throw new Error("workspace_quota_exceeded");
      stored.push(item);
    }
    stored.sort((left, right) => left.path.localeCompare(right.path));
    validateManifest(stored);
    await atomicWrite(
      join(this.root, "manifests", `${sessionName(sessionId)}.json`),
      Buffer.from(JSON.stringify({ version: MANIFEST_VERSION, entries: stored })),
    );
    await removeUnreferencedBlobs(this.root, await retainedBlobHashes(this.root));
  }

  commit(sessionId: string, entries: AgentWorkspaceEntry[]): Promise<void> {
    return this.mutate(() => this.commitUnlocked(sessionId, entries));
  }

  applyDelta(sessionId: string, delta: AgentWorkspaceDelta): Promise<void> {
    return this.mutate(async () => {
      const entries = new Map((await this.load(sessionId)).map((entry) => [entry.path, entry]));
      for (const path of delta.removedPaths) {
        AgentWorkspacePathSchema.parse(path);
        entries.delete(path);
      }
      for (const entry of delta.entries) entries.set(entry.path, entry);
      await this.commitUnlocked(sessionId, [...entries.values()]);
    });
  }

  delete(sessionId: string): Promise<void> {
    return this.mutate(async () => {
      await rm(join(this.root, "manifests", `${sessionName(sessionId)}.json`), { force: true });
      await removeUnreferencedBlobs(this.root, await retainedBlobHashes(this.root));
    });
  }
}

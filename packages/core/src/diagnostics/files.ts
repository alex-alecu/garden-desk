import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { AgentWorkspacePathSchema, ContentHashSchema } from "@gardendesk/shared";
import { DebugSessionError, debugStateInvalid } from "./errors.js";

const MAX_WORKSPACE_BYTES = 128 * 1024 * 1024;
const WORKSPACE_ATTEMPTS = 3;
const run = promisify(execFile);

const WINDOWS_PRIVATE_DIRECTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('GARDEN_DESK_SNAPSHOT_PATH', 'Process')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ([string]::IsNullOrEmpty($path) -or $null -eq $sid) { throw 'missing snapshot identity' }
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
if (Test-Path -LiteralPath $path) {
  [IO.Directory]::SetAccessControl($path, $acl)
} else {
  [void][IO.Directory]::CreateDirectory($path, $acl)
}
$actual = [IO.Directory]::GetAccessControl($path)
$rules = @($actual.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'snapshot DACL verification failed' }
`;

interface ManifestEntry {
  kind: "directory" | "file";
  path: string;
  contentHash?: string;
  byteLength?: number;
}

export interface WorkspaceEntry {
  kind: "directory" | "file";
  path: string;
  bytes?: Buffer;
}

export interface StableWorkspace {
  entries: WorkspaceEntry[];
  manifestHash: string | null;
}

async function readOwnedFile(path: string): Promise<Buffer> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const state = await handle.stat();
    const wrongOwner = process.getuid !== undefined && state.uid !== process.getuid();
    if (!state.isFile() || wrongOwner || state.nlink !== 1) debugStateInvalid();
    return await handle.readFile();
  } catch (error) {
    if (error instanceof DebugSessionError) throw error;
    throw Object.assign(new DebugSessionError("debug_state_invalid"), {
      cause: error,
    });
  } finally {
    await handle?.close();
  }
}

function parseManifestEntry(item: unknown): ManifestEntry {
  if (typeof item !== "object" || item === null) return debugStateInvalid();
  const entry = item as Record<string, unknown>;
  if (entry.kind !== "directory" && entry.kind !== "file") return debugStateInvalid();
  const path = AgentWorkspacePathSchema.parse(entry.path);
  if (entry.kind === "directory") return { kind: "directory", path };
  if (
    typeof entry.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(entry.contentHash) ||
    !Number.isSafeInteger(entry.byteLength) ||
    (entry.byteLength as number) < 0
  ) {
    return debugStateInvalid();
  }
  return {
    kind: "file",
    path,
    contentHash: entry.contentHash,
    byteLength: entry.byteLength as number,
  };
}

function validateManifestEntries(entries: ManifestEntry[]): void {
  const paths = new Set<string>();
  const files = new Set(
    entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
  );
  for (const entry of entries) {
    if (paths.has(entry.path)) debugStateInvalid();
    paths.add(entry.path);
    const parts = entry.path.split("/");
    for (let length = 1; length < parts.length; length += 1) {
      if (files.has(parts.slice(0, length).join("/"))) debugStateInvalid();
    }
  }
}

function parseManifest(bytes: Buffer): ManifestEntry[] {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as {
      version?: unknown;
      entries?: unknown;
    };
    if (value.version !== 1 || !Array.isArray(value.entries)) debugStateInvalid();
    const entries = value.entries.map(parseManifestEntry);
    validateManifestEntries(entries);
    return entries;
  } catch (error) {
    if (error instanceof DebugSessionError) throw error;
    return debugStateInvalid();
  }
}

async function manifestExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new DebugSessionError("debug_state_invalid");
  }
}

async function loadWorkspaceAttempt(
  workspaceRoot: string,
  manifestPath: string,
): Promise<StableWorkspace | undefined> {
  const before = await readOwnedFile(manifestPath);
  const entries = await loadManifestEntries(workspaceRoot, parseManifest(before));
  const after = await readOwnedFile(manifestPath);
  if (!before.equals(after)) return undefined;
  return {
    entries,
    manifestHash: createHash("sha256").update(before).digest("hex"),
  };
}

function missingCause(error: unknown): boolean {
  if (!(error instanceof DebugSessionError)) return false;
  const cause = (error as Error & { cause?: unknown }).cause as NodeJS.ErrnoException | undefined;
  return cause?.code === "ENOENT";
}

async function loadManifestEntries(
  workspaceRoot: string,
  entries: ManifestEntry[],
): Promise<WorkspaceEntry[]> {
  let total = 0;
  const output: WorkspaceEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "directory") {
      output.push(entry);
      continue;
    }
    const bytes = await readOwnedFile(join(workspaceRoot, "blobs", entry.contentHash ?? ""));
    total += bytes.byteLength;
    if (
      bytes.byteLength !== entry.byteLength ||
      total > MAX_WORKSPACE_BYTES ||
      createHash("sha256").update(bytes).digest("hex") !== entry.contentHash
    ) {
      throw new DebugSessionError("debug_content_hash_mismatch");
    }
    output.push({ kind: "file", path: entry.path, bytes });
  }
  return output;
}

export async function readStableWorkspace(
  internalRoot: string,
  sessionId: string,
): Promise<StableWorkspace> {
  const workspaceRoot = join(internalRoot, "agent-workspaces");
  const manifestPath = join(workspaceRoot, "manifests", `${sessionId.toLowerCase()}.json`);
  if (!(await manifestExists(manifestPath))) return { entries: [], manifestHash: null };
  for (let attempt = 0; attempt < WORKSPACE_ATTEMPTS; attempt += 1) {
    try {
      const workspace = await loadWorkspaceAttempt(workspaceRoot, manifestPath);
      if (workspace !== undefined) return workspace;
    } catch (error) {
      if (!missingCause(error)) throw error;
    }
  }
  throw new DebugSessionError("debug_workspace_changed");
}

export async function safeDatabasePath(path: string): Promise<string> {
  try {
    const canonical = await realpath(resolve(path));
    const state = await lstat(canonical);
    const wrongOwner = process.getuid !== undefined && state.uid !== process.getuid();
    if (!state.isFile() || state.isSymbolicLink() || wrongOwner || state.nlink !== 1) {
      throw new DebugSessionError("debug_database_unsafe");
    }
    return canonical;
  } catch (error) {
    if (error instanceof DebugSessionError) throw error;
    throw new DebugSessionError("debug_database_unsafe");
  }
}

export async function makeSnapshotDirectory(): Promise<string> {
  const root =
    process.platform === "win32"
      ? join(tmpdir(), `garden-desk-session-debug-${randomUUID()}`)
      : await mkdtemp(join(tmpdir(), "garden-desk-session-debug-"));
  try {
    await makePrivateDirectory(root);
    return root;
  } catch (error) {
    await removeSnapshot(root);
    throw error;
  }
}

export async function readVerifiedArtifact(
  internalRoot: string,
  hash: string,
  expectedBytes?: number,
): Promise<Buffer> {
  const digest = ContentHashSchema.parse(hash).slice("sha256:".length);
  const bytes = await readOwnedFile(join(internalRoot, "artifacts", digest.slice(0, 2), digest));
  if (
    (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) ||
    createHash("sha256").update(bytes).digest("hex") !== digest
  ) {
    throw new DebugSessionError("debug_content_hash_mismatch");
  }
  return bytes;
}

export async function makePrivateDirectory(path: string): Promise<void> {
  if (process.platform === "win32") {
    await run(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_PRIVATE_DIRECTORY_SCRIPT],
      {
        env: { ...process.env, GARDEN_DESK_SNAPSHOT_PATH: path },
        windowsHide: true,
      },
    );
    return;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function writePrivateFile(path: string, bytes: Uint8Array): Promise<void> {
  await makePrivateDirectory(dirname(path));
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  await chmod(path, 0o600);
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await writePrivateFile(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

export async function removeSnapshot(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

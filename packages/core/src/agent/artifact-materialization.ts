import { constants } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AuditLog } from "../audit/log.js";
import type { ArtifactStore } from "../workspace/artifacts.js";
import type { DatabasePort } from "../workspace/database.js";
import { type ArtifactRow, artifactFromRow } from "./records.js";

function artifactForSession(database: DatabasePort, sessionId: string, artifactId: string) {
  const row = database
    .prepare(
      "SELECT agent_artifacts.* FROM agent_artifacts JOIN agent_runs ON agent_runs.id = agent_artifacts.run_id WHERE agent_artifacts.id = ? AND agent_runs.session_id = ?",
    )
    .get(artifactId, sessionId) as ArtifactRow | undefined;
  return row === undefined ? undefined : artifactFromRow(row);
}

interface ArtifactReference {
  artifactId: string;
  artifacts: ArtifactStore;
  database: DatabasePort;
  sessionId: string;
}

interface ArtifactExport extends ArtifactReference {
  destination: string;
}

async function writeOwnerOnly(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function materializeArtifact(reference: ArtifactReference): Promise<string> {
  const item = artifactForSession(reference.database, reference.sessionId, reference.artifactId);
  if (item === undefined) throw new Error("artifact_not_found");
  const name = basename(item.name);
  if (name.length === 0) throw new Error("artifact_name_invalid");
  const directory = await mkdtemp(join(tmpdir(), "vault-deliverable-"));
  await chmod(directory, 0o700);
  const path = join(directory, name);
  try {
    await writeOwnerOnly(path, await reference.artifacts.read(item.contentHash));
    return path;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function destinationExists(path: string): Promise<boolean> {
  try {
    const state = await lstat(path);
    if (!state.isFile() || state.isSymbolicLink()) throw new Error("artifact_export_unsafe");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function linkWithoutClobber(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("artifact_export_changed");
    }
    throw error;
  }
}

interface ExportTarget {
  device: number;
  inode: number;
  parent: string;
  target: string;
}

async function verifiedExportTarget(destination: string): Promise<ExportTarget> {
  if (!isAbsolute(destination) || destination.includes("\0")) {
    throw new Error("artifact_export_unsafe");
  }
  const requestedTarget = resolve(destination);
  const requestedParent = resolve(dirname(requestedTarget));
  const parentState = await lstat(requestedParent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink()) {
    throw new Error("artifact_export_unsafe");
  }
  const parent = await realpath(requestedParent);
  const canonicalParentState = await lstat(parent);
  if (
    canonicalParentState.dev !== parentState.dev ||
    canonicalParentState.ino !== parentState.ino
  ) {
    throw new Error("artifact_export_changed");
  }
  const target = join(parent, basename(requestedTarget));
  if (await destinationExists(target)) throw new Error("artifact_export_exists");
  return {
    device: canonicalParentState.dev,
    inode: canonicalParentState.ino,
    parent,
    target,
  };
}

async function commitExport(destination: ExportTarget, bytes: Uint8Array): Promise<void> {
  const { device, inode, parent, target } = destination;
  const temporary = join(parent, `.vault-export-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    await writeOwnerOnly(temporary, bytes);
    const parentAfter = await lstat(parent);
    if (
      parentAfter.dev !== device ||
      parentAfter.ino !== inode ||
      (await realpath(parent)) !== parent
    ) {
      throw new Error("artifact_export_changed");
    }
    if (await destinationExists(target)) throw new Error("artifact_export_changed");
    await linkWithoutClobber(temporary, target);
    await unlink(temporary);
    await syncDirectory(parent);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function exportArtifact(reference: ArtifactExport): Promise<void> {
  const item = artifactForSession(reference.database, reference.sessionId, reference.artifactId);
  if (item === undefined) throw new Error("artifact_not_found");
  const destination = await verifiedExportTarget(reference.destination);
  await commitExport(destination, await reference.artifacts.read(item.contentHash));
}

async function auditedArtifactAction<T>(options: {
  action(): Promise<T>;
  audit: AuditLog;
  artifactId: string;
  sessionId: string;
  type: string;
}): Promise<T> {
  try {
    const result = await options.action();
    options.audit.append({
      type: options.type,
      outcome: "succeeded",
      metadata: { sessionId: options.sessionId, artifactId: options.artifactId },
    });
    return result;
  } catch (error) {
    options.audit.append({
      type: options.type,
      outcome: "failed",
      metadata: { sessionId: options.sessionId, artifactId: options.artifactId },
    });
    throw error;
  }
}

export async function materializeAndAuditArtifact(
  reference: ArtifactReference & { audit: AuditLog },
): Promise<string> {
  return await auditedArtifactAction({
    ...reference,
    type: "artifact.opened",
    action: async () => await materializeArtifact(reference),
  });
}

export async function exportAndAuditArtifact(
  reference: ArtifactExport & { audit: AuditLog },
): Promise<void> {
  await auditedArtifactAction({
    ...reference,
    type: "artifact.exported",
    action: async () => await exportArtifact(reference),
  });
}

export class ArtifactMaterializer {
  constructor(
    private readonly database: DatabasePort,
    private readonly artifacts: ArtifactStore,
    private readonly audit: AuditLog,
  ) {}

  async materialize(sessionId: string, artifactId: string): Promise<string> {
    return await materializeAndAuditArtifact({
      database: this.database,
      artifacts: this.artifacts,
      audit: this.audit,
      sessionId,
      artifactId,
    });
  }

  async export(sessionId: string, artifactId: string, destination: string): Promise<void> {
    await exportAndAuditArtifact({
      database: this.database,
      artifacts: this.artifacts,
      audit: this.audit,
      sessionId,
      artifactId,
      destination,
    });
  }
}

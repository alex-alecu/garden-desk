// biome-ignore lint/style/noRestrictedImports: this module is the Core-owned image file authority.
import { constants } from "node:fs";
// biome-ignore lint/style/noRestrictedImports: this module validates and snapshots approved image files.
import { chmod, type FileHandle, lstat, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { DatabasePort } from "../workspace/database.js";
import { inspectFolderGrant } from "../workspace/folder-grants.js";
import { guestAttachmentName } from "./inputs.js";
import type { AgentStore } from "./store.js";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_EDGE = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;

export interface ResolvedAgentImage {
  path: string;
  dispose(): Promise<void>;
}

function sessionFolder(database: DatabasePort, sessionId: string) {
  return database
    .prepare(
      "SELECT f.root_path, f.revoked_at FROM sessions s LEFT JOIN folder_grants f ON f.id = s.folder_id WHERE s.id = ?",
    )
    .get(sessionId) as { root_path: string | null; revoked_at: string | null } | undefined;
}

function pngSize(bytes: Buffer): { width: number; height: number } | undefined {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return undefined;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("image_invalid");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: JPEG framing requires bounded marker handling.
function jpegSize(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (length < 7) break;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("image_invalid");
}

function validateImage(bytes: Buffer): "png" | "jpg" {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("image_size_unsupported");
  const png = pngSize(bytes);
  const jpeg = png === undefined ? jpegSize(bytes) : undefined;
  const size = png ?? jpeg;
  if (
    size === undefined ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > MAX_IMAGE_EDGE ||
    size.height > MAX_IMAGE_EDGE ||
    size.width * size.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(
      size === undefined ? "image_format_unsupported" : "image_dimensions_unsupported",
    );
  }
  return png === undefined ? "jpg" : "png";
}

function sourcePathParts(guestPath: string): string[] {
  if (!guestPath.startsWith("/source/") || guestPath.includes("\0")) {
    throw new Error("image_path_outside_context");
  }
  const parts = guestPath.slice("/source/".length).split("/");
  if (parts.length === 0 || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("image_path_outside_context");
  }
  return parts;
}

function requireWithinRoot(root: string, path: string): void {
  const fromRoot = relative(root, path);
  const parentPrefix = `..${process.platform === "win32" ? "\\" : "/"}`;
  if (
    fromRoot === "" ||
    isAbsolute(fromRoot) ||
    fromRoot.startsWith(parentPrefix) ||
    fromRoot === ".."
  ) {
    throw new Error("image_path_outside_context");
  }
}

async function readBoundedImage(handle: FileHandle): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(MAX_IMAGE_BYTES + 1);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  if (total > MAX_IMAGE_BYTES) throw new Error("image_size_unsupported");
  return buffer.subarray(0, total);
}

async function readFolderImage(root: string, guestPath: string): Promise<Buffer> {
  const parts = sourcePathParts(guestPath);
  const candidate = join(root, ...parts);
  const canonicalRoot = await realpath(root);
  const canonical = await realpath(candidate);
  requireWithinRoot(canonicalRoot, canonical);
  const before = await lstat(candidate);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_IMAGE_BYTES) {
    throw new Error("image_invalid");
  }
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const canonicalState = await lstat(canonical);
    if (
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      !canonicalState.isFile() ||
      canonicalState.isSymbolicLink() ||
      opened.dev !== canonicalState.dev ||
      opened.ino !== canonicalState.ino ||
      (await realpath(candidate)) !== canonical
    ) {
      throw new Error("image_changed");
    }
    const bytes = await readBoundedImage(handle);
    const after = await handle.stat();
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      after.ctimeMs !== opened.ctimeMs
    ) {
      throw new Error("image_changed");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export class AgentImageInputResolver {
  constructor(
    private readonly database: DatabasePort,
    private readonly store: AgentStore,
  ) {}

  private async bytes(sessionId: string, guestPath: string): Promise<Buffer> {
    const attachmentPrefix = "/run/attachments/";
    if (guestPath.startsWith(attachmentPrefix)) {
      const guestName = guestPath.slice(attachmentPrefix.length);
      const item = this.store
        .listAttachments(sessionId)
        .find((candidate, index) => guestAttachmentName(index, candidate.name) === guestName);
      if (item === undefined) throw new Error("image_not_found");
      if (item.byteLength > MAX_IMAGE_BYTES) throw new Error("image_size_unsupported");
      const bytes = await this.store.attachmentBytes(item);
      if (bytes.byteLength !== item.byteLength) throw new Error("image_changed");
      return bytes;
    }
    const session = sessionFolder(this.database, sessionId);
    if (session === undefined) throw new Error("session_not_found");
    if (session.revoked_at !== null) throw new Error("folder_grant_revoked");
    if (session.root_path === null) throw new Error("image_path_outside_context");
    const root = inspectFolderGrant(session.root_path).canonicalPath;
    return await readFolderImage(root, guestPath);
  }

  async resolve(sessionId: string, guestPath: string): Promise<ResolvedAgentImage> {
    const bytes = await this.bytes(sessionId, guestPath);
    const extension = validateImage(bytes);
    const temporaryRoot = await mkdtemp(join(tmpdir(), "vault-image-"));
    const path = join(temporaryRoot, `input.${extension}`);
    try {
      const handle = await open(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o400,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(temporaryRoot, 0o700);
      let disposed = false;
      return {
        path: await realpath(path),
        async dispose() {
          if (disposed) return;
          disposed = true;
          await rm(temporaryRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

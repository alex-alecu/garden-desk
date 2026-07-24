import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  makePrivateDirectory,
  type WorkspaceEntry,
  writePrivateFile,
  writePrivateJson,
} from "./files.js";

interface WorkspaceSnapshotEntry {
  kind: "directory" | "file";
  path: string;
  snapshotPath?: string;
  byteLength?: number;
  sha256?: string;
}

function snapshotEntry(entry: WorkspaceEntry, index: number): WorkspaceSnapshotEntry {
  if (entry.kind === "directory") return entry;
  const bytes = entry.bytes ?? Buffer.alloc(0);
  return {
    kind: "file",
    path: entry.path,
    snapshotPath: `files/${String(index).padStart(8, "0")}`,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function writeWorkspaceSnapshot(
  root: string,
  entries: WorkspaceEntry[],
): Promise<void> {
  await makePrivateDirectory(join(root, "files"));
  const snapshotEntries = entries.map(snapshotEntry);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const snapshot = snapshotEntries[index];
    if (entry?.kind !== "file" || snapshot?.snapshotPath === undefined) continue;
    await writePrivateFile(
      join(root, "files", String(index).padStart(8, "0")),
      entry.bytes ?? Buffer.alloc(0),
    );
  }
  await writePrivateJson(join(root, "manifest.json"), {
    version: 1,
    entries: snapshotEntries,
  });
}

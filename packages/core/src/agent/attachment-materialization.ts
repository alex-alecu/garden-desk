import { constants } from "node:fs";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { AuditLog } from "../audit/log.js";
import type { ArtifactStore } from "../workspace/artifacts.js";
import type { DatabasePort } from "../workspace/database.js";
import { type AttachmentRow, attachmentFromRow } from "./records.js";
import type { AgentStore } from "./store.js";

export async function materializeAttachment(
  database: DatabasePort,
  artifacts: ArtifactStore,
  sessionId: string,
  attachmentId: string,
): Promise<string> {
  const row = database
    .prepare("SELECT * FROM session_attachments WHERE id = ? AND session_id = ?")
    .get(attachmentId, sessionId) as AttachmentRow | undefined;
  if (row === undefined) throw new Error("attachment_not_found");
  const item = attachmentFromRow(row);
  if (basename(item.name) !== item.name) throw new Error("attachment_name_invalid");
  const directory = await mkdtemp(join(tmpdir(), "garden-desk-attachment-"));
  await chmod(directory, 0o700);
  const path = join(directory, item.name);
  try {
    const handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(await artifacts.read(item.contentHash));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return path;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function materializeAndAuditAttachment(
  store: AgentStore,
  audit: AuditLog,
  sessionId: string,
  attachmentId: string,
): Promise<string> {
  const path = await store.materializeAttachment(sessionId, attachmentId);
  audit.append({
    type: "attachment.opened",
    outcome: "succeeded",
    metadata: { sessionId, attachmentId },
  });
  return path;
}

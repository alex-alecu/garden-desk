import { constants } from "node:fs";
import { mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentInputFile } from "@gardendesk/workers";
import type { DatabasePort } from "../workspace/database.js";
import { inspectFolderGrant } from "../workspace/folder-grants.js";
import type { AgentStore } from "./store.js";

const MAX_ATTACHMENTS = 64;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024 * 1024;

export interface ResolvedAgentInputs {
  sourceFolder: string;
  attachments: AgentInputFile[];
  dispose(): Promise<void>;
}

export function guestAttachmentName(index: number, name: string): string {
  return `${String(index + 1).padStart(2, "0")}-${name}`;
}

function sessionFolder(database: DatabasePort, sessionId: string) {
  return database
    .prepare(
      "SELECT f.root_path, f.revoked_at FROM sessions s LEFT JOIN folder_grants f ON f.id = s.folder_id WHERE s.id = ?",
    )
    .get(sessionId) as { root_path: string | null; revoked_at: string | null } | undefined;
}

export class AgentInputResolver {
  constructor(
    private readonly database: DatabasePort,
    private readonly store: AgentStore,
  ) {}

  async resolve(sessionId: string): Promise<ResolvedAgentInputs> {
    const session = sessionFolder(this.database, sessionId);
    if (session === undefined) throw new Error("session_not_found");
    if (session.revoked_at !== null) throw new Error("folder_grant_revoked");
    const attachments = this.store.listAttachments(sessionId);
    if (attachments.length > MAX_ATTACHMENTS) throw new Error("worker_input_limit_exceeded");
    const temporaryRoot = await mkdtemp(join(tmpdir(), `garden-desk-inputs-${sessionId}-`));
    const attachmentsRoot = join(temporaryRoot, "attachments");
    const emptySource = join(temporaryRoot, "source");
    const files: AgentInputFile[] = [];
    let total = 0;
    try {
      await Promise.all([mkdir(attachmentsRoot), mkdir(emptySource)]);
      for (const [index, item] of attachments.entries()) {
        const bytes = await this.store.attachmentBytes(item);
        total += bytes.byteLength;
        if (total > MAX_ATTACHMENT_BYTES) throw new Error("worker_input_limit_exceeded");
        const path = join(attachmentsRoot, `attachment-${index}`);
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
        files.push({ path, name: guestAttachmentName(index, item.name) });
      }
      const sourceFolder =
        session.root_path === null
          ? emptySource
          : await realpath(inspectFolderGrant(session.root_path).canonicalPath);
      return {
        sourceFolder,
        attachments: files,
        async dispose() {
          await rm(temporaryRoot, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
}

import { randomUUID } from "node:crypto";
import { type WorkspaceRecord, WorkspaceRecordSchema } from "@gardendesk/shared";
import type { DatabasePort } from "./database.js";

interface WorkspaceRow {
  id: string;
  root_path: string;
  created_at: string;
}

export function getOrCreateWorkspace(database: DatabasePort, rootPath: string): WorkspaceRecord {
  const existing = database
    .prepare("SELECT id, root_path, created_at FROM workspace LIMIT 1")
    .get() as WorkspaceRow | undefined;
  if (existing !== undefined) {
    if (existing.root_path !== rootPath) throw new Error("workspace_root_mismatch");
    return WorkspaceRecordSchema.parse({
      schemaVersion: 1,
      id: existing.id,
      rootPath: existing.root_path,
      createdAt: existing.created_at,
    });
  }
  const record = WorkspaceRecordSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    rootPath,
    createdAt: new Date().toISOString(),
  });
  database
    .prepare("INSERT INTO workspace (id, root_path, created_at) VALUES (?, ?, ?)")
    .run(record.id, record.rootPath, record.createdAt);
  return record;
}

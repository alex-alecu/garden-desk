import type { FolderSummary } from "@vault/shared";
import type { DatabasePort } from "../workspace/database.js";

interface FolderOrderRow {
  id: string;
}

export function reorderFolderRows(
  database: DatabasePort,
  folderIds: string[],
  listFolders: () => FolderSummary[],
): FolderSummary[] {
  const active = database
    .prepare(
      "SELECT id FROM folder_grants WHERE revoked_at IS NULL ORDER BY sort_order, created_at, id",
    )
    .all() as FolderOrderRow[];
  const activeIds = active.map((row) => row.id);
  if (
    folderIds.length !== activeIds.length ||
    new Set(folderIds).size !== folderIds.length ||
    folderIds.some((id) => !activeIds.includes(id))
  ) {
    throw new Error("invalid_folder_order");
  }
  database.transaction(() => {
    const update = database.prepare(
      "UPDATE folder_grants SET sort_order = ? WHERE id = ? AND revoked_at IS NULL",
    );
    folderIds.forEach((id, index) => {
      update.run(index, id);
    });
  })();
  return listFolders();
}

import { win32 } from "node:path";
import type { DatabasePort } from "../workspace/database.js";
import { inspectFolderGrant } from "../workspace/folder-grants.js";

export interface RelinkableFolderGrant {
  id: string;
  root_path: string;
  display_name: string;
  created_at: string;
  revoked_at: string | null;
}

function driveRoot(path: string): string | undefined {
  const root = win32.parse(path).root;
  return /^[A-Za-z]:\\$/u.test(root) ? root : undefined;
}

export function sameWindowsPathAfterDriveChange(previous: string, selected: string): boolean {
  const previousPath = win32.normalize(previous);
  const selectedPath = win32.normalize(selected);
  const previousRoot = driveRoot(previousPath);
  const selectedRoot = driveRoot(selectedPath);
  return (
    previousRoot !== undefined &&
    selectedRoot !== undefined &&
    previousRoot.toLowerCase() !== selectedRoot.toLowerCase() &&
    previousPath.slice(previousRoot.length).toLowerCase() ===
      selectedPath.slice(selectedRoot.length).toLowerCase()
  );
}

export function unavailableFolderAfterDriveChange(
  database: DatabasePort,
  selectedPath: string,
): RelinkableFolderGrant | undefined {
  const candidates = database
    .prepare(
      "SELECT id, root_path, display_name, created_at, revoked_at FROM folder_grants WHERE revoked_at IS NULL",
    )
    .all() as RelinkableFolderGrant[];
  const unavailable = candidates.filter((candidate) => {
    if (!sameWindowsPathAfterDriveChange(candidate.root_path, selectedPath)) return false;
    try {
      inspectFolderGrant(candidate.root_path);
      return false;
    } catch {
      return true;
    }
  });
  return unavailable.length === 1 ? unavailable[0] : undefined;
}

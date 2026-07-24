import { join } from "node:path";

export function debugSidecarCheckArguments(root: string, executable: string): string[] {
  return [
    "--import",
    "tsx",
    join(root, "packages/core/src/diagnostics/package-check.ts"),
    executable,
  ];
}

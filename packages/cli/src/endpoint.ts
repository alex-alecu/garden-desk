import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export function daemonEndpoint(workspaceDir: string): string {
  const workspaceRoot = realpathSync.native(resolve(workspaceDir));
  if (process.platform === "win32") {
    const name = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 32);
    return `\\\\.\\pipe\\garden-desk-cored-${name}`;
  }
  return join(workspaceRoot, ".garden-desk", "core.sock");
}

import { createHash, randomUUID } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: this test uses an isolated temporary workspace store.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { WindowsMicroVmLauncher } from "./windows.js";
import { AgentWorkspaceStore } from "./workspace-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("reads committed workspace bytes through the public Windows launcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "garden-desk-windows-workspace-read-"));
  roots.push(root);
  const store = await AgentWorkspaceStore.create(root);
  const sessionId = randomUUID();
  const bytes = Buffer.from("committed Windows result");
  await store.commit(sessionId, [
    {
      kind: "file",
      path: "result.txt",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      bytesBase64: bytes.toString("base64"),
    },
  ]);
  const launcher = new WindowsMicroVmLauncher("unused-helper", "unused-images", root);

  await expect(launcher.readWorkspaceFile(sessionId, "result.txt")).resolves.toEqual(bytes);
});

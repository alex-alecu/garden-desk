import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultCore, startDaemon } from "@vault/core";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];
const itWindows = process.platform === "win32" ? it : it.skip;

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vault-m1-daemon-concurrent-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function runStatusCli(workspace: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((accept) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "packages/cli/src/main.ts", "status", "--workspace", workspace, "--json"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.once("close", (code) => accept({ code, stdout }));
  });
}

describe("M1 Windows daemon concurrency", () => {
  itWindows("serves simultaneous current-user CLI requests across pipe recreation", async () => {
    const root = await temporaryRoot();
    const modelStoreDir = join(root, ".test-models");
    await mkdir(modelStoreDir);
    await writeFile(
      join(modelStoreDir, "installed-models.json"),
      JSON.stringify({ schemaVersion: 1, models: [] }),
    );
    const core = await createVaultCore({ workspaceDir: root, modelStoreDir, profile: "local12" });
    const daemon = await startDaemon(core, root);
    const requests = await Promise.all(Array.from({ length: 8 }, () => runStatusCli(root)));

    expect(requests.every((request) => request.code === 0)).toBe(true);
    expect(requests.every((request) => JSON.parse(request.stdout).status === "ok")).toBe(true);
    await daemon.close();
    await core.close();
  });
});

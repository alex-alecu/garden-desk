// biome-ignore lint/style/noRestrictedImports: this focused test helper runs the generated guest script.
import { execFile } from "node:child_process";
// biome-ignore lint/style/noRestrictedImports: this focused test helper creates guest input bytes.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { source } from "./chat-loop-test-support.js";
import { readRegistry } from "./generic-read-test-support.js";

const run = promisify(execFile);

describe("generic write and edit", () => {
  it("rejects a path outside /workspace before any guest execution", async () => {
    const runs: Parameters<AgentExecutor["execute"]>[0][] = [];

    const result = await readRegistry(runs).execute("write", {
      path: "/source/notes.txt",
      content: "x",
    });

    expect(result).toMatchObject({ failed: true, invalidInput: true });
    expect(runs).toHaveLength(0);
  });

  it("fails an ambiguous old match unless replace_all is set", async () => {
    const runs: Parameters<AgentExecutor["execute"]>[0][] = [];
    await readRegistry(runs).execute("edit", {
      path: "/workspace/notes.txt",
      old: "value",
      new: "other",
    });
    const program = source(runs[0] as (typeof runs)[number]);
    const root = await mkdtemp(join(tmpdir(), "vault-generic-edit-"));
    try {
      await writeFile(join(root, "notes.txt"), "value\nvalue\n");
      const guestRoot = (await realpath(root)).replaceAll("\\", "/");
      const path = join(root, "edit.py");
      await writeFile(path, program.replaceAll("/workspace", guestRoot));
      await expect(
        run(process.platform === "win32" ? "python" : "python3", [path], {
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }),
      ).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("edit_old_not_unique") });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

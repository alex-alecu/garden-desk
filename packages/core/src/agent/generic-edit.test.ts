import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { source } from "./chat-loop-test-support.js";
import { readRegistry, runGuestProgram } from "./generic-read-test-support.js";

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

    const result = await runGuestProgram({ "notes.txt": "value\nvalue\n" }, async (guestRoot) =>
      program.replaceAll("/workspace", guestRoot),
    );

    expect(result).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("edit_old_not_unique"),
    });
  });
});

import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { compactedTaskState, currentRunNeedsCompaction } from "./prompt-compaction.js";
import { defaultPromptLibrary } from "./prompt-library.js";

function execution(stdout: string): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/read.py",
    source: "print('records')",
    command: null,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

describe("current-run context compaction", () => {
  it("creates inspectable ledgers with exact salient evidence", () => {
    const stdout = [
      "ordinary row",
      "record-03517,38687,COMPACTION_TARGET",
      "COMPACTION_TOTAL=38687",
      "x".repeat(80_000),
    ].join("\n");

    const compacted = compactedTaskState({
      task: "Find COMPACTION_TARGET and return COMPACTION_TOTAL.",
      executions: [execution(stdout)],
      observationCharacters: 32_000,
      library: defaultPromptLibrary(),
    });

    expect(compacted).toContain("# Compacted task state");
    expect(compacted).toContain("record-03517,38687,COMPACTION_TARGET");
    expect(compacted).toContain("COMPACTION_TOTAL=38687");
    expect(compacted).toContain('"stdoutCharacters":80073');
    expect(compacted).toContain("durable execution records and workspace files remain unchanged");
  });

  it("does not claim compaction while observations fit", () => {
    expect(
      compactedTaskState({
        task: "Summarize.",
        executions: [execution("small")],
        observationCharacters: 32_000,
        library: defaultPromptLibrary(),
      }),
    ).toBe("");
  });

  it("treats an empty evidence ledger as completed work rather than missing evidence", () => {
    const compacted = compactedTaskState({
      task: "Print 1100000 letter x characters.",
      executions: [execution("x".repeat(80_000))],
      observationCharacters: 32_000,
      library: defaultPromptLibrary(),
    });

    expect(compacted).toContain("Evidence ledger: []");
    expect(compacted).toContain("An empty evidence ledger means");
    expect(compacted).toContain("respond now");
  });

  it("detects when current-run streams exceed the live evidence budget", () => {
    expect(currentRunNeedsCompaction([execution("x".repeat(40_000))])).toBe(true);
    expect(currentRunNeedsCompaction([execution("small")])).toBe(false);
  });
});

import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { anchorIsCurrent, EMPTY_ANCHORED_LEDGER, mergeAnchoredLedger } from "./prompt-anchor.js";
import { compactedTaskState, LedgerAnchor } from "./prompt-compaction.js";
import { defaultPromptLibrary } from "./prompt-library.js";

function execution(stdout: string, overrides: Partial<AgentExecutionResult> = {}) {
  return {
    language: "python",
    path: "steps/0001.py",
    source: "print('records')",
    command: null,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
    ...overrides,
  } as AgentExecutionResult;
}

describe("anchored ledger merge", () => {
  it("unions evidence and artifacts without duplicating a repeated observation", () => {
    const first = mergeAnchoredLedger(
      EMPTY_ANCHORED_LEDGER,
      { evidence: ["TOTAL=5"], artifacts: ["out.xlsx"], warnings: [] },
      1,
      { evidence: 24, warnings: 8 },
    );
    const second = mergeAnchoredLedger(
      first,
      { evidence: ["TOTAL=5", "COUNT=2"], artifacts: ["out.xlsx"], warnings: [] },
      2,
      { evidence: 24, warnings: 8 },
    );
    expect(second.evidence).toEqual(["TOTAL=5", "COUNT=2"]);
    expect(second.artifacts).toEqual(["out.xlsx"]);
    expect(second.coveredExecutions).toBe(2);
  });

  it("keeps one warning per step so a repaired step reports once", () => {
    const warning = { step: 2, exitCode: 1, termination: "crash", stderr: "SyntaxError" };
    const merged = mergeAnchoredLedger(
      mergeAnchoredLedger(
        EMPTY_ANCHORED_LEDGER,
        { evidence: [], artifacts: [], warnings: [warning] },
        2,
        {
          evidence: 24,
          warnings: 8,
        },
      ),
      { evidence: [], artifacts: [], warnings: [{ ...warning, stderr: "SyntaxError repeated" }] },
      2,
      { evidence: 24, warnings: 8 },
    );
    expect(merged.warnings).toHaveLength(1);
    expect(merged.warnings[0]?.stderr).toBe("SyntaxError repeated");
  });

  it("treats an anchor as current only once it covers every execution", () => {
    const anchor = { ...EMPTY_ANCHORED_LEDGER, coveredExecutions: 1 };
    expect(anchorIsCurrent(anchor, [execution("a")])).toBe(true);
    expect(anchorIsCurrent(anchor, [execution("a"), execution("b")])).toBe(false);
  });
});

describe("anchored compaction equivalence", () => {
  it("produces the same ledgers as a from-scratch build", () => {
    const executions = [
      execution(`TOTAL_VALUE=42\n${"filler ".repeat(4_000)}`),
      execution(`COUNT_VALUE=7\n${"filler ".repeat(4_000)}`),
    ];
    const library = defaultPromptLibrary();
    const anchor = new LedgerAnchor();
    const task = "Report TOTAL_VALUE and COUNT_VALUE.";
    // Build once at step one so the anchor carries forward, exactly as repeated
    // prompt builds do inside a run.
    compactedTaskState({
      task,
      executions: [executions[0] as AgentExecutionResult],
      observationCharacters: 100,
      library,
      anchor,
    });
    const anchored = compactedTaskState({
      task,
      executions,
      observationCharacters: 100,
      library,
      anchor,
    });
    const scratch = compactedTaskState({
      task,
      executions,
      observationCharacters: 100,
      library,
    });
    expect(anchored).toBe(scratch);
    expect(anchored).toContain("TOTAL_VALUE=42");
    expect(anchored).toContain("COUNT_VALUE=7");
  });

  it("rescans only executions the anchor has not covered", () => {
    const anchor = new LedgerAnchor();
    const first = anchor.advance("Report TOTAL_VALUE.", [execution("TOTAL_VALUE=42")]);
    expect(first.coveredExecutions).toBe(1);
    const unchanged = anchor.advance("Report TOTAL_VALUE.", [execution("TOTAL_VALUE=42")]);
    expect(unchanged).toBe(first);
  });
});

describe("multi-execution anchored evidence", () => {
  it("retains explicit target evidence from every compacted execution", () => {
    const executions = [1, 2, 3].map((stage) =>
      execution(
        [
          `ID: target-${stage}, Amount: ${stage * 10}, Status: STAGE_${stage}_TARGET`,
          ...Array.from(
            { length: 50 },
            (_, index) =>
              `ID: ordinary-${stage}-${index}, Amount: ${index}, Status: ordinary-record`,
          ),
        ].join("\n"),
      ),
    );
    const anchor = new LedgerAnchor();
    const library = defaultPromptLibrary();
    const task = "Return STAGE_1_TARGET, STAGE_2_TARGET, and STAGE_3_TARGET amounts.";
    for (let count = 1; count <= executions.length; count += 1) {
      compactedTaskState({
        task,
        executions: executions.slice(0, count),
        observationCharacters: 100,
        library,
        anchor,
      });
    }
    const compacted = compactedTaskState({
      task,
      executions,
      observationCharacters: 100,
      library,
      anchor,
    });
    for (const stage of [1, 2, 3]) expect(compacted).toContain(`STAGE_${stage}_TARGET`);
  });
});

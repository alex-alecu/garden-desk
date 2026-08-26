import type { AgentExecutionSnapshot, AgentRunSnapshot } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { savedScriptRepairEvidence } from "./m3-saved-script-evidence.js";

const requirement = {
  brokenSource: 'raise RuntimeError("repair-needed")\n',
  finalOutput: "python-saved-repair",
  language: "python" as const,
  path: "steps/saved-repair.py",
  repairedSource: 'print("python-saved-repair")\n',
};

function execution(overrides: Partial<AgentExecutionSnapshot> = {}): AgentExecutionSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001" as never,
    runId: "00000000-0000-4000-8000-000000000002" as never,
    sequence: 0,
    language: "python",
    path: requirement.path,
    source: requirement.brokenSource,
    command: null,
    state: "failed",
    exitCode: 1,
    durationMs: 1,
    termination: "crash",
    stdout: "",
    stderr: "RuntimeError: repair-needed\n",
    vmDiagnostics: [
      {
        sequence: 0,
        code: "process_start",
        platform: "guest",
        platformCode: null,
        createdAt: "2026-08-26T00:00:00.000Z",
      },
      {
        sequence: 1,
        code: "process_exit",
        platform: "guest",
        platformCode: null,
        createdAt: "2026-08-26T00:00:01.000Z",
      },
    ],
    stdoutBytes: 0,
    stderrBytes: 28,
    vmDiagnosticsBytes: 1,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:01.000Z",
    completedAt: "2026-08-26T00:00:01.000Z",
    ...overrides,
  };
}

function toolStarted(item: AgentExecutionSnapshot, index: number, source: string | null) {
  return {
    id: `call-${index}` as never,
    runId: item.runId,
    sequence: index * 3,
    type: "tool.started" as const,
    summary: "Running Python.",
    toolName: "python",
    toolCallId: `tool-${index}`,
    language: "python" as const,
    path: requirement.path,
    source,
    command: null,
    exitCode: null,
    stdout: null,
    stderr: null,
    durationMs: null,
    termination: null,
    createdAt: "2026-08-26T00:00:00.000Z",
  };
}

function executionEvents(executions: AgentExecutionSnapshot[], rerunSource: string | null) {
  return executions.flatMap((item, index) => {
    const call = toolStarted(item, index, index === 2 ? rerunSource : item.source);
    const started = {
      ...call,
      id: `start-${index}` as never,
      sequence: index * 3 + 1,
      type: "execution.started" as const,
      summary: "Running code.",
      source: item.source,
    };
    const completed = {
      ...call,
      id: `done-${index}` as never,
      sequence: index * 3 + 2,
      type: "execution.completed" as const,
      summary: "Finished this step.",
      exitCode: item.exitCode,
      stdout: item.stdout,
      stderr: item.stderr,
      durationMs: item.durationMs,
      termination: item.termination,
    };
    return [call, started, completed];
  });
}

function snapshot(
  executions: AgentExecutionSnapshot[],
  rerunSource: string | null,
): AgentRunSnapshot {
  return {
    run: {
      state: "succeeded",
      response: `Final output: ${requirement.finalOutput}`,
    } as AgentRunSnapshot["run"],
    events: executionEvents(executions, rerunSource),
    executions,
    artifacts: [],
    thinking: null,
    contextUsedTokens: null,
    contextAllocatedTokens: null,
    question: null,
  };
}

function repaired(sequence: number): AgentExecutionSnapshot {
  return execution({
    sequence,
    source: requirement.repairedSource,
    state: "completed",
    exitCode: 0,
    stdout: `${requirement.finalOutput}\n`,
    stderr: "",
    termination: "completed",
  });
}

describe("saved-script repair evidence", () => {
  it("accepts a failed script, its exact repaired bytes, and a saved-path rerun", () => {
    const evidence = savedScriptRepairEvidence(
      snapshot([execution(), repaired(1), repaired(2)], null),
      requirement,
    );

    expect(evidence).toMatchObject({
      passed: true,
      recordedExecutedSource: requirement.repairedSource,
      observations: { repair: "resaved_source", rerun: "path_only" },
    });
  });

  it("does not accept different bytes for the repair and rerun", () => {
    const evidence = savedScriptRepairEvidence(
      snapshot(
        [execution(), repaired(1), repaired(2)].map((item, index) =>
          index === 2 ? { ...item, source: `${requirement.repairedSource}# changed\n` } : item,
        ),
        null,
      ),
      requirement,
    );

    expect(evidence.passed).toBe(false);
    expect(evidence.failures).toContain("missing_stable_repaired_source");
  });

  it("does not accept a missing recorded source", () => {
    const evidence = savedScriptRepairEvidence(
      snapshot(
        [execution(), repaired(1), repaired(2)].map((item, index) =>
          index === 0 ? item : { ...item, source: null },
        ),
        null,
      ),
      requirement,
    );

    expect(evidence.passed).toBe(false);
    expect(evidence.failures).toContain("missing_stable_repaired_source");
  });
});

describe("saved-script repair process evidence", () => {
  it("requires typed process evidence for the repaired execution", () => {
    const withoutProcessEvidence = repaired(1);
    withoutProcessEvidence.vmDiagnostics = [];
    const evidence = savedScriptRepairEvidence(
      snapshot([execution(), withoutProcessEvidence, repaired(2)], null),
      requirement,
    );

    expect(evidence.passed).toBe(false);
    expect(evidence.failures).toContain("missing_typed_repair_evidence");
  });
});

describe("saved-script repair observations", () => {
  it("reports a full-source rerun but does not make it a hard failure", () => {
    const evidence = savedScriptRepairEvidence(
      snapshot([execution(), repaired(1), repaired(2)], requirement.repairedSource),
      requirement,
    );

    expect(evidence).toMatchObject({
      passed: true,
      observations: { rerun: "full_source" },
    });
  });

  it("reports a saved-file edit but does not make it a hard failure", () => {
    const repairedByEdit = snapshot([execution(), repaired(1), repaired(2)], null);
    const repairCall = repairedByEdit.events.find(
      (event) => event.type === "tool.started" && event.sequence === 3,
    );
    if (repairCall === undefined) throw new Error("Missing repair call fixture.");
    repairCall.source = null;
    const evidence = savedScriptRepairEvidence(repairedByEdit, requirement);

    expect(evidence).toMatchObject({
      passed: true,
      observations: {
        rerun: "path_only",
        repair: "edited_saved_file",
      },
    });
  });
});

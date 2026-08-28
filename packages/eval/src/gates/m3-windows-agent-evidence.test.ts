import type { AgentExecutionSnapshot, AgentRunSnapshot } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  boundedOutputEvidence,
  cancelledEvidence,
  completedEvidence,
  hasRunningLiveMarker,
  hasTeardownOrBoundedExit,
  selectedAgentEvidence,
} from "./m3-windows-agent-evidence.js";

function execution(overrides: Partial<AgentExecutionSnapshot> = {}): AgentExecutionSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001" as never,
    runId: "00000000-0000-4000-8000-000000000002" as never,
    sequence: 0,
    language: "python",
    path: null,
    source: null,
    command: null,
    state: "completed",
    exitCode: 0,
    durationMs: 1,
    termination: "completed",
    stdout: "start\nfinish\n",
    stderr: "",
    vmDiagnostics: [
      {
        sequence: 0,
        code: "process_exit",
        platform: "windows",
        platformCode: null,
        createdAt: new Date().toISOString(),
      },
    ],
    stdoutBytes: 13,
    stderrBytes: 0,
    vmDiagnosticsBytes: 1,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function snapshot(
  executions: AgentExecutionSnapshot[],
  state: AgentRunSnapshot["run"]["state"],
): AgentRunSnapshot {
  return {
    run: { state } as AgentRunSnapshot["run"],
    events: [],
    executions,
    artifacts: [],
    thinking: null,
    contextUsedTokens: null,
    contextAllocatedTokens: null,
    question: null,
  };
}

function boundedOutput(overrides: Partial<AgentExecutionSnapshot> = {}): AgentExecutionSnapshot {
  return execution({
    state: "failed",
    termination: "resource_limit",
    stdout: `limit-start\n${"x".repeat(999_988)}`,
    stdoutBytes: 1_000_000,
    stdoutTruncated: true,
    vmDiagnostics: [
      {
        sequence: 0,
        code: "process_start",
        platform: "guest",
        platformCode: null,
        createdAt: new Date().toISOString(),
      },
      {
        sequence: 1,
        code: "process_exit",
        platform: "guest",
        platformCode: null,
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  });
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused evidence cases share one snapshot fixture.
describe("Windows agent evidence", () => {
  it("observes any running execution with the live marker", () => {
    const earlier = execution({ stdout: "start\n", state: "completed" });
    const running = execution({
      sequence: 1,
      state: "running",
      exitCode: null,
      termination: null,
      completedAt: null,
      stdout: "start\n",
    });

    expect(hasRunningLiveMarker(snapshot([earlier, running], "running"), "start")).toBe(true);
  });

  it("selects one later complete execution after an earlier failed repair", () => {
    const failed = execution({
      state: "failed",
      exitCode: 1,
      termination: "completed",
      stdout: "start\n",
    });
    const valid = execution({ sequence: 1, stdout: "start\nfinish\n" });

    expect(
      completedEvidence(snapshot([failed, valid], "succeeded"), {
        startToken: "start",
        finishToken: "finish",
        stdoutTruncated: false,
      }),
    ).toBe(valid);
  });

  it("does not combine a start marker with a finish marker from another execution", () => {
    const started = execution({ stdout: "start\n" });
    const finished = execution({ sequence: 1, stdout: "finish\n" });

    expect(
      completedEvidence(snapshot([started, finished], "succeeded"), {
        startToken: "start",
        finishToken: "finish",
        stdoutTruncated: false,
      }),
    ).toBeUndefined();
  });

  it("requires a finish marker for normal evidence", () => {
    expect(
      selectedAgentEvidence(snapshot([execution()], "succeeded"), {
        cancel: false,
        startToken: "start",
        stdoutTruncated: false,
      }),
    ).toBeUndefined();
  });

  it("selects one bounded-output execution without a finish marker", () => {
    const limit = boundedOutput();

    expect(
      boundedOutputEvidence(snapshot([limit], "succeeded"), { startToken: "limit-start" }),
    ).toBe(limit);
  });

  it("uses terminal bounded-output evidence without a separate teardown diagnostic", () => {
    const limit = boundedOutput();

    expect(hasTeardownOrBoundedExit(snapshot([limit], "succeeded"), limit)).toBe(true);
  });

  it("accepts the guest exit code for a killed bounded-output process", () => {
    const limit = boundedOutput({ exitCode: 255 });

    expect(
      boundedOutputEvidence(snapshot([limit], "succeeded"), { startToken: "limit-start" }),
    ).toBe(limit);
  });

  it("does not combine bounded-output evidence across executions", () => {
    const started = boundedOutput({ vmDiagnostics: [] });
    const exited = boundedOutput({
      sequence: 1,
      stdout: "x".repeat(1_000_000),
    });

    expect(
      boundedOutputEvidence(snapshot([started, exited], "succeeded"), {
        startToken: "limit-start",
      }),
    ).toBeUndefined();
  });

  it("rejects completed and non-resource-limit bounded output", () => {
    const completed = boundedOutput({ state: "completed", termination: "completed" });
    const crashed = boundedOutput({ termination: "crash" });

    expect(
      boundedOutputEvidence(snapshot([completed], "succeeded"), { startToken: "limit-start" }),
    ).toBeUndefined();
    expect(
      boundedOutputEvidence(snapshot([crashed], "succeeded"), { startToken: "limit-start" }),
    ).toBeUndefined();
  });

  it("keeps cancellation evidence separate from successful completion", () => {
    const cancelled = execution({ state: "cancelled", exitCode: null, termination: "cancelled" });

    expect(cancelledEvidence(snapshot([cancelled], "cancelled"))).toBe(cancelled);
  });
});

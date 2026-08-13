import {
  AgentArtifactSummarySchema,
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { stressResultFor } from "./m3-stress-reporting.js";
import type { ActiveCase } from "./m3-stress-runtime.js";

const timestamp = "2026-08-10T08:00:00.000Z";
const COMPLETE_TABLE = [
  "| Marker | Amount |",
  "| --- | ---: |",
  "| SYNTH_REVENUE_M01_A1 | 10,101 |",
  "| SYNTH_REVENUE_M01_A2 | 10102 |",
].join("\n");

function execution(stdout: string, failed = false) {
  return AgentExecutionSnapshotSchema.parse({
    id: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    sequence: 0,
    language: "python",
    path: "steps/0001.py",
    source: "print('result')",
    command: null,
    state: failed ? "failed" : "completed",
    exitCode: failed ? 1 : 0,
    durationMs: 1,
    termination: "completed",
    stdout,
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: 0,
    vmDiagnosticsBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  });
}

function snapshot(
  response: string,
  executions: AgentExecutionSnapshot[],
  artifacts: AgentRunSnapshot["artifacts"] = [],
) {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
      sessionId: "da911f87-ff26-46d8-9a58-bad222a584ab",
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      state: "succeeded",
      response,
      error: null,
      performance: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    executions,
    artifacts,
    thinking: null,
  });
}

function artifact() {
  return AgentArtifactSummarySchema.parse({
    id: "33333333-3333-4333-8333-333333333333",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    name: "unexpected.xlsx",
    mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    byteLength: 3,
    contentHash: `sha256:${"0".repeat(64)}`,
    createdAt: timestamp,
  });
}

function pathListCase(): ActiveCase {
  return {
    fixture: {
      id: "excel-chat-path-list",
      source: "/tmp/excel-chat-path-list",
      task: "Search all excel files.",
      fixtureMs: 1,
      evidence: { bytes: 2, files: 2, expected: {} },
      expectedTokens: [],
      expectedTableRows: [{ amount: 10_101 }, { amount: 10_102 }],
      forbidArtifacts: true,
    },
    folderId: "folder",
    previousSnapshots: [],
    sessionId: "session",
    runId: "run",
    startedAt: performance.now(),
  };
}

function result(
  response = COMPLETE_TABLE,
  executions = [execution("complete")],
  artifacts: AgentRunSnapshot["artifacts"] = [],
) {
  return stressResultFor(pathListCase(), snapshot(response, executions, artifacts));
}

describe("direct XLSX path-list output evidence", () => {
  it("accepts a complete table without private progress or prompt-shape evidence", () => {
    expect(result()).toMatchObject({
      passed: true,
      missingTokens: [],
      missingTableRows: [],
    });
  });

  it("reports missing and wrong table rows", () => {
    const firstOnly = "| Marker | Amount |\n| --- | ---: |\n| SYNTH_REVENUE_M01_A1 | 10,101 |";
    const wrong = `${firstOnly}\n| SYNTH_REVENUE_M01_A2 | 99999 |`;
    const expectedMissing = [{ amount: 10_102 }];
    expect(result(firstOnly).missingTableRows).toEqual(expectedMissing);
    expect(result(wrong).missingTableRows).toEqual(expectedMissing);
  });
});

describe("direct XLSX path-list artifact boundary", () => {
  it("rejects an artifact when the task requires a chat result", () => {
    expect(result(COMPLETE_TABLE, undefined, [artifact()])).toMatchObject({
      passed: false,
      error: "Expected no artifacts.",
    });
  });
});

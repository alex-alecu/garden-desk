import {
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { stressResultFor } from "./m3-stress-reporting.js";
import type { ActiveCase } from "./m3-stress-runtime.js";

const timestamp = "2026-07-27T08:00:00.000Z";

function execution(stdout: string): AgentExecutionSnapshot {
  return AgentExecutionSnapshotSchema.parse({
    id: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    sequence: 0,
    language: "python",
    path: "steps/0001.py",
    source: "print('result')",
    command: null,
    state: "completed",
    exitCode: 0,
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

function snapshot(response: string, stdout = ""): AgentRunSnapshot {
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
    executions: stdout.length === 0 ? [] : [execution(stdout)],
    artifacts: [],
    thinking: null,
  });
}

describe("M3 stress result evidence", () => {
  it("does not accept an expected token found only in a prior continuation run", () => {
    const active: ActiveCase = {
      fixture: {
        id: "xlsx-folder",
        source: "/tmp/xlsx-folder",
        task: "Inspect every XLSX file.",
        fixtureMs: 1,
        evidence: { bytes: 1, files: 1, expected: { matches: 500 } },
        expectedTokens: ["XLSX_MATCHES=500"],
      },
      folderId: "folder",
      previousSnapshots: [snapshot("Continue?", "XLSX_MATCHES=500\n")],
      sessionId: "session",
      runId: "run",
      startedAt: performance.now(),
    };

    const result = stressResultFor(active, snapshot("XLSX_MATCHES=499"));

    expect(result.passed).toBe(false);
    expect(result.missingTokens).toEqual(["XLSX_MATCHES=500"]);
  });
});

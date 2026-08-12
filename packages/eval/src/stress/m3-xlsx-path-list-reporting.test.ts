import {
  AgentArtifactSummarySchema,
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  AgentTraceSchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { stressResultFor } from "./m3-stress-reporting.js";
import type { ActiveCase } from "./m3-stress-runtime.js";

const timestamp = "2026-08-10T08:00:00.000Z";
const COMPLETE_PROGRESS =
  "VAULT_PROGRESS_DONE=2\nVAULT_PROGRESS_TOTAL=2\nVAULT_PROGRESS_COMPLETE=1\n";
const COMPLETE_TABLE = [
  "| Marker | Amount |",
  "| --- | ---: |",
  "| SYNTH_REVENUE_M01_A1 | 10,101 |",
  "| SYNTH_REVENUE_M01_A2 | 10102 |",
].join("\n");

function execution(stdout: string, language: "python" | "shell" = "python") {
  return AgentExecutionSnapshotSchema.parse({
    id: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    sequence: 0,
    language,
    path: language === "shell" ? null : "steps/0001.py",
    source: language === "shell" ? null : "print('result')",
    command: language === "shell" ? "find /source -type f" : null,
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

function directTrace(prompt = "## Active skill: xlsx-workbooks") {
  return AgentTraceSchema.parse({
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    captureVersion: 1,
    status: "recorded",
    turns: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
        sequence: 0,
        phase: "decision",
        requestId: "22222222-2222-4222-8222-222222222222",
        jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
        modelId: "test",
        contextSize: 131_072,
        maxTokens: 8_192,
        allocatedContextTokens: 131_072,
        promptHash: `sha256:${"0".repeat(64)}`,
        schemaHash: `sha256:${"1".repeat(64)}`,
        responseHash: null,
        prompt,
        jsonSchema: {
          type: "object",
          properties: { source: { type: "array" } },
        },
        structuredResponse: null,
        outcome: "accepted_execution",
        executionSequence: 0,
        createdAt: timestamp,
        responseCapturedAt: timestamp,
        completedAt: timestamp,
      },
    ],
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
      expectedTokens: [
        "VAULT_PROGRESS_DONE=2",
        "VAULT_PROGRESS_TOTAL=2",
        "VAULT_PROGRESS_COMPLETE=1",
      ],
      expectedTableRows: [
        { marker: "SYNTH_REVENUE_M01_A1", amount: 10_101 },
        { marker: "SYNTH_REVENUE_M01_A2", amount: 10_102 },
      ],
      forbidArtifacts: true,
      maxExecutions: 2,
      requiresDirectXlsxSource: true,
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
  executions = [execution(COMPLETE_PROGRESS)],
  trace = directTrace(),
  artifacts: AgentRunSnapshot["artifacts"] = [],
) {
  return stressResultFor(pathListCase(), snapshot(response, executions, artifacts), { trace });
}

describe("direct XLSX path-list output evidence", () => {
  it("accepts complete table, progress, execution, and trace evidence", () => {
    expect(result()).toMatchObject({
      passed: true,
      missingTokens: [],
      missingTableRows: [],
      traceError: null,
    });
  });

  it("reports missing and wrong table rows", () => {
    const firstOnly = "| Marker | Amount |\n| --- | ---: |\n| SYNTH_REVENUE_M01_A1 | 10,101 |";
    const wrong = `${firstOnly}\n| SYNTH_REVENUE_M01_A2 | 99999 |`;
    const expectedMissing = [{ marker: "SYNTH_REVENUE_M01_A2", amount: 10_102 }];
    expect(result(firstOnly).missingTableRows).toEqual(expectedMissing);
    expect(result(wrong).missingTableRows).toEqual(expectedMissing);
  });

  it("requires exact progress coverage from execution stdout", () => {
    const incomplete = execution("VAULT_PROGRESS_DONE=1\nVAULT_PROGRESS_TOTAL=2\n");
    expect(result(COMPLETE_TABLE, [incomplete]).missingTokens).toEqual([
      "VAULT_PROGRESS_DONE=2",
      "VAULT_PROGRESS_COMPLETE=1",
    ]);
  });
});

describe("direct XLSX path-list routing evidence", () => {
  it("rejects shell-first routing and inactive initial guidance", () => {
    const shellResult = result(COMPLETE_TABLE, [execution(COMPLETE_PROGRESS, "shell")]);
    const inactive = result(COMPLETE_TABLE, undefined, directTrace("No active guidance."));
    expect(shellResult.traceError).toContain("Expected Python as the first execution.");
    expect(shellResult.traceError).toContain("Expected no shell execution.");
    expect(inactive.traceError).toBe("Expected active XLSX guidance in the first trace prompt.");
  });

  it("rejects a command-capable first schema", () => {
    const trace = directTrace();
    if (trace.captureVersion !== 1 || trace.turns[0] === undefined) throw new Error("trace");
    trace.turns[0].jsonSchema = {
      type: "object",
      properties: { source: { type: "array" }, command: { type: "string" } },
    };
    expect(result(COMPLETE_TABLE, undefined, trace).traceError).toBe(
      "Expected a source-only first trace schema.",
    );
  });
});

describe("direct XLSX path-list execution limits", () => {
  it("rejects artifacts and more than two executions", () => {
    expect(result(COMPLETE_TABLE, undefined, undefined, [artifact()])).toMatchObject({
      passed: false,
      error: "Expected no artifacts.",
    });
    expect(
      result(COMPLETE_TABLE, [execution(COMPLETE_PROGRESS), execution("2"), execution("3")]),
    ).toMatchObject({ passed: false, error: "Expected at most 2 executions." });
  });
});

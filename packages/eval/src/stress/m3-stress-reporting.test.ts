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

function artifact() {
  return AgentArtifactSummarySchema.parse({
    id: "33333333-3333-4333-8333-333333333333",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    name: "replacement.pdf",
    mediaType: "application/pdf",
    byteLength: 3,
    contentHash: `sha256:${"0".repeat(64)}`,
    createdAt: timestamp,
  });
}

function snapshot(
  response: string,
  stdout = "",
  artifacts: AgentRunSnapshot["artifacts"] = [],
): AgentRunSnapshot {
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
    artifacts,
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

  it("requires every expected deliverable to pass independent verification", () => {
    const active: ActiveCase = {
      fixture: {
        id: "report",
        source: "/tmp/report",
        task: "Create a report.",
        fixtureMs: 1,
        evidence: { bytes: 1, files: 1, expected: {} },
        expectedTokens: [],
        deliverables: [{ name: "report.pdf", facts: ["TOTAL=12"] }],
      },
      folderId: "folder",
      previousSnapshots: [],
      sessionId: "session",
      runId: "run",
      startedAt: performance.now(),
    };

    expect(stressResultFor(active, snapshot("Done."), { verified: [] }).passed).toBe(false);
    expect(stressResultFor(active, snapshot("Done."), { verified: ["report.pdf"] }).passed).toBe(
      true,
    );
  });
});

describe("invalid-input stress evidence", () => {
  it("requires invalid-input evidence without a produced artifact", () => {
    const active: ActiveCase = {
      fixture: {
        id: "invalid-document",
        source: "/tmp/invalid-document",
        task: "Validate the corrupt PDF.",
        fixtureMs: 1,
        evidence: { bytes: 1, files: 1, expected: {} },
        expectedTokens: ["EOF marker not found"],
        forbidArtifacts: true,
        maxExecutions: 1,
      },
      folderId: "folder",
      previousSnapshots: [],
      sessionId: "session",
      runId: "run",
      startedAt: performance.now(),
    };

    expect(stressResultFor(active, snapshot("The PDF is invalid.")).passed).toBe(false);
    expect(
      stressResultFor(active, snapshot("The PDF is invalid.", "EOF marker not found")).passed,
    ).toBe(true);
    expect(
      stressResultFor(
        active,
        snapshot("The PDF is invalid.", "EOF marker not found", [artifact()]),
      ),
    ).toMatchObject({ passed: false, error: "Expected no artifacts." });
  });
});

function compactionCase(): ActiveCase {
  return {
    fixture: {
      id: "context-compaction",
      source: "/tmp/context-compaction",
      task: "Process the full corpus.",
      fixtureMs: 1,
      evidence: { bytes: 1, files: 1, expected: {} },
      expectedTokens: ["COMPACTION_TOTAL=38687"],
      requiresContextCompaction: true,
    },
    folderId: "folder",
    previousSnapshots: [],
    sessionId: "session",
    runId: "run",
    startedAt: performance.now(),
  };
}

function traceWithPrompts(...prompts: string[]) {
  return AgentTraceSchema.parse({
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    captureVersion: 1,
    status: "recorded",
    turns: prompts.map(
      (prompt, index) =>
        ({
          id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
          runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
          sequence: index,
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
          jsonSchema: {},
          structuredResponse: null,
          outcome: "accepted_response",
          executionSequence: null,
          createdAt: timestamp,
          responseCapturedAt: timestamp,
          completedAt: timestamp,
        }) as const,
    ),
  });
}

describe("context compaction stress evidence", () => {
  it("requires an inspectable compacted task record in a later traced prompt", () => {
    const active = compactionCase();
    const result = snapshot("Done.", "COMPACTION_TOTAL=38687\n");

    expect(
      stressResultFor(active, result, { trace: traceWithPrompts("No compaction.") }),
    ).toMatchObject({
      passed: false,
      error: "Expected at least 1 automatic context compaction event.",
    });
    expect(
      stressResultFor(active, result, {
        trace: traceWithPrompts("# Compacted task state\nComplete."),
      }),
    ).toMatchObject({ passed: true, contextCompactions: 1 });
  });

  it("can require repeated turnover instead of one compacted prompt", () => {
    const active = compactionCase();
    active.fixture.minimumContextCompactions = 3;
    active.fixture.requiresContextCompaction = false;
    const result = snapshot("Done.", "COMPACTION_TOTAL=38687\n");
    const compacted = "# Compacted task state\nComplete.";

    expect(
      stressResultFor(active, result, { trace: traceWithPrompts(compacted, compacted) }),
    ).toMatchObject({
      passed: false,
      contextCompactions: 2,
      error: "Expected at least 3 automatic context compaction events.",
    });
    expect(
      stressResultFor(active, result, {
        trace: traceWithPrompts(compacted, compacted, compacted),
      }),
    ).toMatchObject({ passed: true, contextCompactions: 3 });
  });
});

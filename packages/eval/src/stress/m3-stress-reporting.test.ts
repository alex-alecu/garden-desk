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

function execution(stdout: string, source = "print('result')"): AgentExecutionSnapshot {
  return AgentExecutionSnapshotSchema.parse({
    id: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    sequence: 0,
    language: "python",
    path: "steps/0001.py",
    source,
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
  source?: string,
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
    executions: stdout.length === 0 ? [] : [execution(stdout, source)],
    artifacts,
    thinking: null,
  });
}

const wordSkillActive: ActiveCase = {
  fixture: {
    id: "legacy-doc-read",
    source: "/tmp/legacy-doc-read",
    task: "Read the legacy Word file.",
    fixtureMs: 1,
    evidence: { bytes: 1, files: 1, expected: {} },
    expectedTokens: [],
    requiredSkills: ["word-documents"],
  },
  folderId: "folder",
  previousSnapshots: [],
  sessionId: "session",
  runId: "run",
  startedAt: performance.now(),
};

const wordSkillTrace = AgentTraceSchema.parse({
  captureVersion: 1,
  status: "recorded",
  runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
  turns: [
    {
      id: "33e6c437-ce41-40d2-99b6-2c8d119c50ee",
      runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
      sequence: 0,
      phase: "chat",
      requestId: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      modelId: "model",
      contextSize: "auto",
      maxTokens: 8192,
      allocatedContextTokens: 8192,
      promptHash: `sha256:${"1".repeat(64)}`,
      schemaHash: `sha256:${"2".repeat(64)}`,
      responseHash: `sha256:${"3".repeat(64)}`,
      prompt: "prompt",
      jsonSchema: {},
      structuredResponse: {
        text: "",
        toolCalls: [{ id: "skill-1", name: "skill", params: { name: "word-documents" } }],
        stopReason: "toolCalls",
      },
      outcome: "accepted_tool_calls",
      executionSequence: null,
      createdAt: timestamp,
      responseCapturedAt: timestamp,
      completedAt: timestamp,
    },
  ],
});

describe("M3 stress result evidence", () => {
  it("does not accept an expected token found only in tool output", () => {
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
      previousSnapshots: [],
      sessionId: "session",
      runId: "run",
      startedAt: performance.now(),
    };

    const result = stressResultFor(active, snapshot("XLSX_MATCHES=499", "XLSX_MATCHES=500\n"));

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

describe("skill-call stress evidence", () => {
  it("requires the named skill call when a case declares one", () => {
    expect(stressResultFor(wordSkillActive, snapshot("Done.")).missingSkills).toEqual([
      "word-documents",
    ]);
    expect(
      stressResultFor(wordSkillActive, snapshot("Done."), { trace: wordSkillTrace }),
    ).toMatchObject({ passed: true, missingSkills: [] });
  });

  it("requires declared guest execution text", () => {
    const active = {
      ...wordSkillActive,
      fixture: {
        ...wordSkillActive.fixture,
        requiredSkills: [],
        requiredExecutionText: ["antiword"],
      },
    };
    expect(stressResultFor(active, snapshot("Done.")).missingExecutionText).toEqual(["antiword"]);
    expect(
      stressResultFor(active, snapshot("Done.", "read", [], "antiword legacy.doc")),
    ).toMatchObject({
      passed: true,
      missingExecutionText: [],
    });
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
        expectedTokens: ["invalid"],
        forbidArtifacts: true,
      },
      folderId: "folder",
      previousSnapshots: [],
      sessionId: "session",
      runId: "run",
      startedAt: performance.now(),
    };

    expect(stressResultFor(active, snapshot("The PDF could not be read.")).passed).toBe(false);
    expect(stressResultFor(active, snapshot("The PDF is INVALID.")).passed).toBe(true);
    expect(
      stressResultFor(active, snapshot("The PDF is INVALID.", "", [artifact()])),
    ).toMatchObject({ passed: false, error: "Expected no artifacts." });
  });
});

import {
  type AgentExecutionSnapshot,
  AgentExecutionSnapshotSchema,
  AgentRunSnapshotSchema,
  AgentTraceSchema,
  type ChatToolCall,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  approvedSource,
  cLocale,
  discoveredSource,
  returnCodeGuardSource,
} from "./legacy-doc-test-fixtures.js";
import { stressResultFor } from "./m3-stress-reporting.js";
import type { ActiveCase } from "./m3-stress-runtime.js";

const timestamp = "2026-08-23T10:00:00.000Z";
const sourcePath = "/source/legacy-sample.doc";

const active: ActiveCase = {
  fixture: {
    id: "legacy-doc-read",
    source: "/tmp/legacy-doc-read",
    task: "Read the legacy DOC.",
    fixtureMs: 1,
    evidence: { bytes: 1, files: 1, expected: {} },
    expectedTokens: [],
    requiredExecutionText: ["/usr/bin/antiword", "UTF-8.txt"],
    requiredSkills: ["word-documents"],
    forbidArtifacts: true,
  },
  folderId: "folder",
  previousSnapshots: [],
  sessionId: "session",
  runId: "run",
  startedAt: performance.now(),
};

function execution(
  source: string,
  options: Partial<
    Pick<AgentExecutionSnapshot, "command" | "exitCode" | "language" | "state">
  > = {},
): AgentExecutionSnapshot {
  const state = options.state ?? "completed";
  return AgentExecutionSnapshotSchema.parse({
    id: "8ba23ef5-400e-49e6-9bb6-2e3e2c9075bc",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    sequence: 0,
    language: options.language ?? "python",
    path: "steps/0001.py",
    source,
    command: options.command ?? null,
    state,
    exitCode: options.exitCode ?? (state === "completed" ? 0 : 1),
    durationMs: 1,
    termination: state === "completed" ? "completed" : "crash",
    stdout: "",
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: 0,
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

function snapshot(executions: AgentExecutionSnapshot[]) {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
      sessionId: "da911f87-ff26-46d8-9a58-bad222a584ab",
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      state: "succeeded",
      response: "Done.",
      error: null,
      performance: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    executions,
    artifacts: [],
    thinking: null,
  });
}

function trace(...calls: ChatToolCall[]) {
  return AgentTraceSchema.parse({
    captureVersion: 1,
    status: "recorded",
    runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
    turns: calls.map((call, sequence) => ({
      id: "33e6c437-ce41-40d2-99b6-2c8d119c50ee",
      runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
      sequence,
      phase: "chat",
      requestId: "8ba23ef5-400e-49e6-9bb6-2e3e2c9075bc",
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
      structuredResponse: { text: "", toolCalls: [call], stopReason: "toolCalls" },
      outcome: "accepted_tool_calls",
      executionSequence: null,
      createdAt: timestamp,
      responseCapturedAt: timestamp,
      completedAt: timestamp,
    })),
  });
}

function call(name: string, params: Record<string, unknown>): ChatToolCall {
  return { id: name, name, params };
}

function result(executions: AgentExecutionSnapshot[], calls: ChatToolCall[]) {
  return stressResultFor(active, snapshot(executions), { trace: trace(...calls) });
}

function pythonResult(source: string) {
  return result(
    [execution(source)],
    [call("skill", { name: "word-documents" }), call("python", { source })],
  );
}

describe("legacy DOC stress order evidence", () => {
  it("accepts the check=True Python failure path after the Word skill load", () => {
    expect(pythonResult(approvedSource)).toMatchObject({
      passed: true,
      legacyDocMethodValid: true,
      legacyDocOrderValid: true,
      repairMethod: "approved_legacy_doc_extraction",
    });
  });

  it("rejects DOC access before the Word skill", () => {
    expect(
      result(
        [execution(approvedSource)],
        [call("read", { path: sourcePath }), call("skill", { name: "word-documents" })],
      ),
    ).toMatchObject({ passed: false, legacyDocOrderValid: false });
  });

  it("rejects a later Word skill load", () => {
    expect(
      result(
        [execution(approvedSource)],
        [call("python", { source: approvedSource }), call("skill", { name: "word-documents" })],
      ),
    ).toMatchObject({ passed: false, legacyDocOrderValid: false });
  });
});

describe("legacy DOC stress method evidence", () => {
  it("accepts default and explicit return-code failure guards", () => {
    expect(pythonResult(returnCodeGuardSource)).toMatchObject({ passed: true });
    expect(
      pythonResult(returnCodeGuardSource.replace("timeout=5)", "timeout=5, check=False)")),
    ).toMatchObject({
      passed: true,
    });
  });

  it("accepts a discovered /source DOC variable", () => {
    expect(pythonResult(discoveredSource)).toMatchObject({
      passed: true,
      legacyDocMethodValid: true,
    });
  });

  it("rejects a PATH shell Antiword command", () => {
    const shell = `LC_ALL=C antiword -m UTF-8.txt -w 0 ${sourcePath}`;
    expect(
      result(
        [execution("", { command: shell, language: "shell" })],
        [call("skill", { name: "word-documents" }), call("bash", { command: shell })],
      ),
    ).toMatchObject({ passed: false, legacyDocMethodValid: false, legacyDocOrderValid: true });
  });

  it("rejects a missing return-code failure guard", () => {
    expect(pythonResult(approvedSource.replace(", check=True", ""))).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });

  it("rejects an unrelated DOC path and invalid Antiword options", () => {
    expect(pythonResult(approvedSource.replace(sourcePath, "/workspace/legacy.doc"))).toMatchObject(
      {
        passed: false,
        legacyDocMethodValid: false,
      },
    );
    expect(pythonResult(approvedSource.replace('"-w", "0"', '"-w", "72"'))).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });

  it("rejects an extraction that accepts blank text", () => {
    const blankAccepted = approvedSource.replace(
      '\nif not text.strip():\n    raise RuntimeError("Antiword returned no text")',
      "",
    );
    expect(pythonResult(blankAccepted)).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });
});

describe("legacy DOC process controls", () => {
  it("rejects a missing C locale or timeout", () => {
    expect(pythonResult(approvedSource.replace(`, ${cLocale}`, ""))).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
    expect(pythonResult(approvedSource.replace(", timeout=5", ""))).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });
});

describe("legacy DOC statement evidence", () => {
  it("rejects a return-code guard in an uncalled function", () => {
    const deadGuard = returnCodeGuardSource.replace(
      'if result.returncode != 0:\n    raise RuntimeError("Antiword failed")',
      'def reject_failure():\n    if result.returncode != 0:\n        raise RuntimeError("Antiword failed")',
    );
    expect(pythonResult(deadGuard)).toMatchObject({ passed: false, legacyDocMethodValid: false });
  });

  it("rejects a blank-text guard in an uncalled function", () => {
    const deadGuard = approvedSource.replace(
      'if not text.strip():\n    raise RuntimeError("Antiword returned no text")',
      'def reject_blank():\n    if not text.strip():\n        raise RuntimeError("Antiword returned no text")',
    );
    expect(pythonResult(deadGuard)).toMatchObject({ passed: false, legacyDocMethodValid: false });
  });

  it("rejects matching guard text in a string literal", () => {
    const matchingText = approvedSource.replace(
      'if not text.strip():\n    raise RuntimeError("Antiword returned no text")',
      'notes = """\nif not text.strip(): raise RuntimeError("Antiword returned no text")\n"""',
    );
    expect(pythonResult(matchingText)).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });

  it("rejects a non-strict text decode", () => {
    expect(
      pythonResult(approvedSource.replace('errors="strict"', 'errors="replace"')),
    ).toMatchObject({
      passed: false,
      legacyDocMethodValid: false,
    });
  });

  it("allows an earlier unrelated repair failure", () => {
    const repair = execution("raise RuntimeError('repair failed')", { state: "failed" });
    expect(
      result(
        [repair, execution(approvedSource)],
        [
          call("bash", { command: "ls /source/missing" }),
          call("skill", { name: "word-documents" }),
          call("python", { source: approvedSource }),
        ],
      ),
    ).toMatchObject({ passed: true, legacyDocMethodValid: true, legacyDocOrderValid: true });
  });
});

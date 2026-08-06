import {
  AgentExecutionSnapshotSchema,
  AgentRunSummarySchema,
  workContinuationMessage,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { continuationQuestion } from "./continuation.js";

const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const timestamp = "2026-07-27T08:00:00.000Z";
const progress = { done: 4, total: 12, complete: false };

describe("desktop continuation question", () => {
  it("derives a question only from matching verified progress", () => {
    const run = AgentRunSummarySchema.parse({
      id: runId,
      sessionId: "da911f87-ff26-46d8-9a58-bad222a584ab",
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      state: "succeeded",
      response: workContinuationMessage(progress),
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const execution = AgentExecutionSnapshotSchema.parse({
      id: "8ba23ef5-400e-49e6-9bb6-3e82cb9075bc",
      runId,
      sequence: 0,
      language: "python",
      path: "steps/0001.py",
      source: "print('progress')",
      command: null,
      state: "completed",
      exitCode: 0,
      durationMs: 1,
      termination: "completed",
      stdout: "VAULT_PROGRESS_DONE=4\nVAULT_PROGRESS_TOTAL=12\nVAULT_PROGRESS_COMPLETE=0\n",
      stderr: "",
      vmDiagnostics: [],
      stdoutBytes: 88,
      stderrBytes: 0,
      vmDiagnosticsBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      vmDiagnosticsTruncated: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: timestamp,
    });
    expect(continuationQuestion(run, [execution])).toEqual({
      runId,
      done: 4,
      total: 12,
    });
    expect(continuationQuestion({ ...run, response: "Not matching" }, [execution])).toBeUndefined();
  });
});

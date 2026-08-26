import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  type AgentTrace,
  AgentTraceSchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { M3_QUALITY_TERMINAL_CODES } from "./m3-evidence-classification.js";
import { stressResultFor } from "./m3-stress-reporting.js";
import type { ActiveCase } from "./m3-stress-runtime.js";

const timestamp = "2026-08-26T12:00:00.000Z";

const active: ActiveCase = {
  fixture: {
    id: "runtime-classification",
    source: "/tmp/runtime-classification",
    task: "Report one value.",
    fixtureMs: 1,
    evidence: { bytes: 1, files: 1, expected: {} },
    expectedTokens: [],
  },
  folderId: "folder",
  previousSnapshots: [],
  sessionId: "session",
  runId: "run",
  startedAt: performance.now(),
};

function snapshot(error: string): AgentRunSnapshot {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
      sessionId: "da911f87-ff26-46d8-9a58-bad222a584ab",
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      state: "failed",
      response: null,
      error,
      performance: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    executions: [],
    artifacts: [],
    thinking: null,
  });
}

function inferenceFailureTrace(): AgentTrace {
  return AgentTraceSchema.parse({
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
        responseHash: null,
        prompt: "prompt",
        jsonSchema: {},
        structuredResponse: null,
        outcome: "inference_failed",
        executionSequence: null,
        createdAt: timestamp,
        responseCapturedAt: null,
        completedAt: timestamp,
      },
    ],
  });
}

describe("M3 stress failure classification", () => {
  it("does not call an inference transport failure a model limit without gate proof", () => {
    expect(
      stressResultFor(active, snapshot("agent_model_failed"), { trace: inferenceFailureTrace() }),
    ).toMatchObject({
      failureClass: "runtime_failure",
      evidenceReference: "trace.inferenceFailures",
    });
  });

  it("records stable terminal quality codes as later readiness candidates", () => {
    for (const code of M3_QUALITY_TERMINAL_CODES) {
      expect(stressResultFor(active, snapshot(code))).toMatchObject({
        failureClass: "product_failure",
        evidenceReference: "run.error",
        qualityCandidate: code,
      });
    }
  });

  it("does not call a quality code a candidate after an inference failure", () => {
    expect(
      stressResultFor(active, snapshot("agent_generation_limit"), {
        trace: inferenceFailureTrace(),
      }),
    ).toMatchObject({
      failureClass: "runtime_failure",
      evidenceReference: "trace.inferenceFailures",
      qualityCandidate: null,
    });
  });
});

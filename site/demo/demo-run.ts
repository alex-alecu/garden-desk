import type { AgentRunPerformance, AgentRunState, AgentRunSummary } from "@vault/shared";
import {
  AgentEventSchema,
  AgentExecutionSnapshotSchema,
  AgentRunSummarySchema,
} from "@vault/shared";

export const demoTime = "2026-07-21T10:00:00.000Z";

export function demoState(polls: number): AgentRunState {
  if (polls === 1) return "queued";
  if (polls === 2) return "running";
  return "succeeded";
}

export function demoPerformance(state: AgentRunState): AgentRunPerformance | null {
  if (state !== "succeeded") return null;
  return {
    promptTokens: 220,
    outputTokens: 128,
    promptTokensPerSecond: 120,
    tokensPerSecond: 32,
    totalDurationMs: 1_050,
  };
}

export function uuid(group: number, sequence: number): string {
  return `${group.toString(16).padStart(8, "0")}-0000-4000-8000-${sequence
    .toString(16)
    .padStart(12, "0")}`;
}

export function createRunSummary(sessionId: string, sequence: number): AgentRunSummary {
  return AgentRunSummarySchema.parse({
    id: uuid(9, sequence),
    sessionId,
    jobId: uuid(10, sequence),
    state: "queued",
    response: null,
    error: null,
    performance: null,
    createdAt: demoTime,
    updatedAt: demoTime,
  });
}

export function demoEvents(runId: string, state: AgentRunSummary["state"]) {
  const items = [
    {
      id: uuid(11, Number.parseInt(runId.slice(-4), 16) * 10 + 1),
      runId,
      sequence: 0,
      type: "run.started",
      summary: "Queued a deterministic browser-only example.",
      createdAt: demoTime,
    },
  ];
  if (state !== "queued") {
    items.push({
      id: uuid(11, Number.parseInt(runId.slice(-4), 16) * 10 + 2),
      runId,
      sequence: 1,
      type: "inference.started",
      summary: "Preparing the synthetic result in browser memory.",
      createdAt: demoTime,
    });
  }
  if (state === "succeeded") {
    items.push({
      id: uuid(11, Number.parseInt(runId.slice(-4), 16) * 10 + 3),
      runId,
      sequence: 2,
      type: "assistant.completed",
      summary: "Synthetic response completed.",
      createdAt: demoTime,
    });
  }
  return AgentEventSchema.array().parse(items);
}

export function demoExecution(runId: string) {
  return AgentExecutionSnapshotSchema.parse({
    id: uuid(12, Number.parseInt(runId.slice(-4), 16)),
    runId,
    sequence: 0,
    language: "python",
    path: "demo/synthetic-example.py",
    source: "Load the selected invented fixture and format its predetermined result.",
    command: null,
    state: "completed",
    exitCode: 0,
    durationMs: 240,
    termination: "completed",
    stdout: "Synthetic fixture formatted in browser memory.\n",
    stderr: "",
    vmDiagnostics: [],
    stdoutBytes: 47,
    stderrBytes: 0,
    vmDiagnosticsBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: demoTime,
    updatedAt: demoTime,
    completedAt: demoTime,
  });
}

import { AgentRunSnapshotSchema, SessionSummarySchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { desktopReducer, initialDesktopState } from "./state.js";

const timestamp = "2026-07-23T12:00:00.000Z";
const session = SessionSummarySchema.parse({
  id: "da911f87-ff26-46d8-9a58-bad222a584ab",
  folderId: null,
  title: "Live logs",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const execution = {
  id: "8546e320-b1ef-48df-8ea1-51524d95ca1a",
  runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
  sequence: 0,
  language: "python" as const,
  path: "steps/live.py",
  source: "print('live')",
  command: null,
  state: "running" as const,
  exitCode: null,
  durationMs: null,
  termination: null,
  stderr: "",
  vmDiagnostics: [],
  stderrBytes: 0,
  vmDiagnosticsBytes: 2,
  stdoutTruncated: false,
  stderrTruncated: false,
  vmDiagnosticsTruncated: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  completedAt: null,
};
const run = {
  id: execution.runId,
  sessionId: session.id,
  jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
  state: "running" as const,
  response: null,
  error: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const earlierSnapshot = AgentRunSnapshotSchema.parse({
  run: {
    ...run,
    id: "2a83bd73-3f02-4e0e-bb94-7c68c2416c5b",
    jobId: "e43426cf-23fa-44ce-a563-e1c99b323d29",
    state: "succeeded",
  },
  events: [],
  executions: [
    {
      ...execution,
      id: "76eb56bf-8b43-4a04-85b2-884e6b6fb83a",
      runId: "2a83bd73-3f02-4e0e-bb94-7c68c2416c5b",
      state: "completed",
      exitCode: 0,
      durationMs: 1,
      termination: "completed",
      stdout: "earlier\n",
      stdoutBytes: 8,
      completedAt: timestamp,
    },
  ],
  artifacts: [],
});

describe("live execution polling state", () => {
  it("replaces an execution snapshot instead of appending duplicates", () => {
    const selected = desktopReducer(initialDesktopState, { type: "session.created", session });
    const first = AgentRunSnapshotSchema.parse({
      run,
      events: [],
      executions: [{ ...execution, stdout: "first\n", stdoutBytes: 6 }],
      artifacts: [],
    });
    const second = AgentRunSnapshotSchema.parse({
      run,
      events: [],
      executions: [{ ...execution, stdout: "first\nsecond\n", stdoutBytes: 13 }],
      artifacts: [],
    });

    const live = desktopReducer(selected, { type: "agent.snapshot", snapshot: first });
    const updated = desktopReducer(live, { type: "agent.snapshot", snapshot: second });
    expect(updated.executions).toHaveLength(1);
    expect(updated.executions[0]?.stdout).toBe("first\nsecond\n");
  });

  it("retains executions from earlier runs in the conversation", () => {
    const selected = desktopReducer(initialDesktopState, { type: "session.created", session });
    const current = AgentRunSnapshotSchema.parse({
      run,
      events: [],
      executions: [{ ...execution, stdout: "current\n", stdoutBytes: 8 }],
      artifacts: [],
    });

    const historical = desktopReducer(selected, {
      type: "agent.snapshot",
      snapshot: earlierSnapshot,
    });
    const updated = desktopReducer(historical, { type: "agent.snapshot", snapshot: current });

    expect(updated.executions.map((item) => item.stdout)).toEqual(["earlier\n", "current\n"]);
  });
});

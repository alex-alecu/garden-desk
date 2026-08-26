import type { AgentExecutionSnapshot, AgentRunSnapshot } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  macOsAgentOverlapEvidence,
  maximumAgentProcessOverlap,
} from "./m3-agent-process-overlap.js";

function execution(startedAt: string, completedAt?: string): AgentExecutionSnapshot {
  return {
    id: crypto.randomUUID() as never,
    runId: crypto.randomUUID() as never,
    sequence: 0,
    language: "python",
    path: null,
    source: "print('ok')",
    command: null,
    state: "completed",
    exitCode: 0,
    durationMs: 1,
    termination: "completed",
    stdout: "ok\n",
    stderr: "",
    vmDiagnostics: [
      {
        sequence: 0,
        code: "process_start",
        platform: "guest",
        platformCode: null,
        createdAt: startedAt,
      },
      ...(completedAt === undefined
        ? []
        : [
            {
              sequence: 1,
              code: "process_exit" as const,
              platform: "guest" as const,
              platformCode: null,
              createdAt: completedAt,
            },
          ]),
    ],
    stdoutBytes: 3,
    stderrBytes: 0,
    vmDiagnosticsBytes: 1,
    stdoutTruncated: false,
    stderrTruncated: false,
    vmDiagnosticsTruncated: false,
    createdAt: startedAt,
    updatedAt: completedAt ?? startedAt,
    completedAt: completedAt ?? startedAt,
  };
}

function snapshot(executions: AgentExecutionSnapshot[], state = "succeeded"): AgentRunSnapshot {
  return {
    run: { state } as AgentRunSnapshot["run"],
    events: [],
    executions,
    artifacts: [],
    thinking: null,
    contextUsedTokens: null,
    contextAllocatedTokens: null,
    question: null,
  };
}

function withVmLifetime(
  item: AgentExecutionSnapshot,
  startedAt: string,
  completedAt: string,
): AgentExecutionSnapshot {
  return {
    ...item,
    vmDiagnostics: [
      {
        sequence: 0,
        code: "vm_start",
        platform: "macos",
        platformCode: null,
        createdAt: startedAt,
      },
      ...item.vmDiagnostics,
      {
        sequence: item.vmDiagnostics.length + 1,
        code: "teardown",
        platform: "macos",
        platformCode: null,
        createdAt: completedAt,
      },
    ],
  };
}

function macSnapshots(firstCompletedAt: string, secondStartedAt: string): AgentRunSnapshot[] {
  return [
    snapshot([
      withVmLifetime(
        execution("2026-08-26T10:00:00.000Z", firstCompletedAt),
        "2026-08-26T09:59:59.000Z",
        "2026-08-26T10:00:20.000Z",
      ),
    ]),
    snapshot([
      withVmLifetime(
        execution(secondStartedAt, "2026-08-26T10:00:15.000Z"),
        "2026-08-26T10:00:01.000Z",
        "2026-08-26T10:00:20.000Z",
      ),
    ]),
  ];
}

describe("canonical M3 process overlap", () => {
  it("counts overlapping processes from different terminal runs", () => {
    expect(
      maximumAgentProcessOverlap([
        snapshot([execution("2026-08-26T10:00:00.000Z", "2026-08-26T10:00:10.000Z")]),
        snapshot([execution("2026-08-26T10:00:05.000Z", "2026-08-26T10:00:15.000Z")]),
      ]),
    ).toBe(2);
  });

  it("does not treat touching process lifetimes as overlap", () => {
    expect(
      maximumAgentProcessOverlap([
        snapshot([execution("2026-08-26T10:00:00.000Z", "2026-08-26T10:00:05.000Z")]),
        snapshot([execution("2026-08-26T10:00:05.000Z", "2026-08-26T10:00:10.000Z")]),
      ]),
    ).toBe(1);
  });

  it("fails closed for non-terminal or incomplete process evidence", () => {
    const complete = snapshot([execution("2026-08-26T10:00:00.000Z", "2026-08-26T10:00:10.000Z")]);
    const missingStart = execution("2026-08-26T10:00:01.000Z", "2026-08-26T10:00:09.000Z");
    missingStart.vmDiagnostics = missingStart.vmDiagnostics.filter(
      (item) => item.code !== "process_start",
    );
    expect(
      maximumAgentProcessOverlap([complete, snapshot([execution("2026-08-26T10:00:01.000Z")])]),
    ).toBe(0);
    expect(maximumAgentProcessOverlap([complete, snapshot([missingStart])])).toBe(0);
    expect(maximumAgentProcessOverlap([complete, snapshot([], "running")])).toBe(0);
  });
});

describe("canonical M3 Mac overlap", () => {
  it("uses stable VM overlap when short Mac processes do not overlap", () => {
    expect(
      macOsAgentOverlapEvidence(
        macSnapshots("2026-08-26T10:00:05.000Z", "2026-08-26T10:00:10.000Z"),
        Date.parse("2026-08-26T10:00:21.000Z"),
      ),
    ).toEqual({ maximumOverlappingVms: 2 });
  });

  it("returns the Mac VM overlap metric", () => {
    expect(
      macOsAgentOverlapEvidence(
        macSnapshots("2026-08-26T10:00:10.000Z", "2026-08-26T10:00:05.000Z"),
        Date.parse("2026-08-26T10:00:21.000Z"),
      ),
    ).toEqual({
      maximumOverlappingVms: 2,
    });
  });
});

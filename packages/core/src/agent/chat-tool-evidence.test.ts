import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { retainWorkspaceEvidence } from "./chat-tool-evidence.js";
import { initialToolState } from "./chat-tool-turn.js";

function completedExecution(): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/repair.py",
    source: "print('ok')",
    command: null,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

describe("inspection artifact evidence", () => {
  it("retains artifact state without inspection source or output", () => {
    const state = initialToolState([]);
    const inspected = completedExecution();
    inspected.artifacts = [
      {
        name: "report.txt",
        mediaType: "text/plain",
        bytesBase64: Buffer.from("report").toString("base64"),
      },
    ];

    retainWorkspaceEvidence(state, {
      content: "inspection output",
      failed: false,
      artifactExecution: inspected,
    });

    expect(state.artifactExecutions).toEqual([
      {
        artifacts: [
          {
            name: "report.txt",
            mediaType: "text/plain",
            bytesBase64: "cmVwb3J0",
          },
        ],
      },
    ]);
  });
});

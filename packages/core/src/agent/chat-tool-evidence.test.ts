import type { AgentExecutionResult, ChatToolCall } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { retainWorkspaceEvidence } from "./chat-tool-evidence.js";
import { initialToolState } from "./chat-tool-turn.js";
import type { AgentToolResult } from "./generic-tools.js";

const call: ChatToolCall = {
  id: "script-call",
  name: "python",
  params: { path: "steps/repair.py", source: "print('ok')" },
};

const blockedResults: Array<[string, AgentToolResult]> = [
  ["invalid", { content: "invalid_source", failed: true, invalidInput: true }],
  ["repeated", { content: "Identical call repeated.", failed: true }],
  ["budget blocked", { content: "Guest execution limit reached.", failed: true }],
  [
    "missing path",
    {
      content: "agent_script_missing",
      failed: true,
    },
  ],
];

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

describe("deterministic workspace script evidence", () => {
  it.each(blockedResults)("does not retain a %s call", (_name, result) => {
    const state = initialToolState([]);

    retainWorkspaceEvidence(state, call, result);

    expect(state.scriptPaths).toEqual([]);
  });

  it("retains a script after its guest execution completes", () => {
    const state = initialToolState([]);

    retainWorkspaceEvidence(state, call, {
      content: "ok",
      failed: false,
      execution: completedExecution(),
    });

    expect(state.scriptPaths).toEqual(["steps/repair.py"]);
  });
});

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
    inspected.invalidatedArtifactPaths = ["old-report.txt"];
    inspected.recoverableArtifactPaths = ["large-report.txt"];

    retainWorkspaceEvidence(
      state,
      { id: "inspection-call", name: "read", params: { path: "/source/input.txt" } },
      { content: "inspection output", failed: false, artifactExecution: inspected },
    );

    expect(state.artifactExecutions).toEqual([
      {
        artifacts: [
          {
            name: "report.txt",
            mediaType: "text/plain",
            bytesBase64: "cmVwb3J0",
          },
        ],
        exitCode: 0,
        invalidatedArtifactPaths: ["old-report.txt"],
        recoverableArtifactPaths: ["large-report.txt"],
        termination: "completed",
      },
    ]);
  });
});

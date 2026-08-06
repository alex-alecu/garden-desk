import {
  AgentEventSchema,
  ConversationMessageSchema,
  workContinuationMessage,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { resolveAgentTask } from "./continuation.js";
import type { DurableAgentHistory } from "./history.js";

const sessionId = "da911f87-ff26-46d8-9a58-bad222a584ab";
const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const createdAt = "2026-07-27T08:00:00.000Z";
const progress = { done: 3, total: 10, complete: false };

function history(response = workContinuationMessage(progress)): DurableAgentHistory {
  return {
    messages: [
      ConversationMessageSchema.parse({
        id: "ee31a359-3b01-4d54-9950-e3d46e807381",
        sessionId,
        role: "user",
        content: "Inspect every XLSX file and print XLSX_MATCHES=<count>.",
        runId: null,
        createdAt,
      }),
      ConversationMessageSchema.parse({
        id: "fe31a359-3b01-4d54-9950-e3d46e807381",
        sessionId,
        role: "assistant",
        content: response,
        runId,
        createdAt,
      }),
    ],
    runs: [
      {
        state: "succeeded",
        events: [
          AgentEventSchema.parse({
            id: "d59ff233-f216-4ee7-a156-a5a1c6cb5ed1",
            runId,
            sequence: 0,
            type: "execution.completed",
            summary: "Processed 3 of 10 XLSX files.",
            language: "python",
            path: "steps/0001.py",
            source: "print('progress')",
            command: null,
            exitCode: 0,
            stdout: "VAULT_PROGRESS_DONE=3\nVAULT_PROGRESS_TOTAL=10\nVAULT_PROGRESS_COMPLETE=0\n",
            stderr: "",
            durationMs: 1,
            termination: "completed",
            createdAt,
          }),
        ],
      },
    ],
  };
}

describe("agent continuation resolution", () => {
  it("restores the original task only after the matching continuation question", () => {
    expect(resolveAgentTask("  CONTINUE ", history())).toEqual({
      task: "Inspect every XLSX file and print XLSX_MATCHES=<count>.",
      continuation: true,
    });
  });

  it("does not reinterpret an ordinary continue message", () => {
    expect(resolveAgentTask("Continue", history("Different response"))).toEqual({
      task: "Continue",
      continuation: false,
    });
  });

  it("keeps repeated approved continuations tied to the original task", () => {
    const repeated = history();
    const secondRunId = "c6ec31cc-8970-4856-b6f2-46ee41984a54";
    repeated.messages.push(
      ConversationMessageSchema.parse({
        id: "954a6b2b-27d6-423b-88dc-4eea3313f24e",
        sessionId,
        role: "user",
        content: "Continue",
        runId: null,
        createdAt,
      }),
      ConversationMessageSchema.parse({
        id: "7399bd71-5b73-43d7-87e6-563eadce7633",
        sessionId,
        role: "assistant",
        content: workContinuationMessage(progress),
        runId: secondRunId,
        createdAt,
      }),
    );
    repeated.runs.push({
      state: "succeeded",
      events: [
        AgentEventSchema.parse({
          ...repeated.runs[0]?.events[0],
          id: "3d041192-3319-49dc-ad2d-cba04806fcc4",
          runId: secondRunId,
        }),
      ],
    });

    expect(resolveAgentTask("Continue", repeated)).toEqual({
      task: "Inspect every XLSX file and print XLSX_MATCHES=<count>.",
      continuation: true,
    });
  });
});

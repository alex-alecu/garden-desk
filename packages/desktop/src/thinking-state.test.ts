import { AgentRunSnapshotSchema, SessionSummarySchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { desktopReducer, initialDesktopState } from "./state.js";

const timestamp = "2026-07-20T12:00:00.000Z";
const firstSession = SessionSummarySchema.parse({
  id: "da911f87-ff26-46d8-9a58-bad222a584ab",
  folderId: null,
  title: "First",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const secondSession = SessionSummarySchema.parse({
  ...firstSession,
  id: "9c79d764-128d-4a75-b04c-4a3739f78d09",
  title: "Second",
});
const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const stepId = "d59ff233-f216-4ee7-a156-a5a1c6cb5ed1";

function snapshot(state: "running" | "succeeded", thinking: string | null) {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: runId,
      sessionId: firstSession.id,
      jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
      state,
      response: state === "succeeded" ? "Done." : null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [
      {
        id: stepId,
        runId,
        sequence: 0,
        type: "inference.started",
        summary: "Planning the task.",
        createdAt: timestamp,
      },
    ],
    artifacts: [],
    thinking,
  });
}

describe("transient thinking state", () => {
  it("keeps thinking after its stream ends and removes it with the session", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: firstSession,
    });
    const withThinking = desktopReducer(selected, {
      type: "agent.snapshot",
      snapshot: snapshot("running", "First thought\nSecond thought"),
    });
    const completed = desktopReducer(withThinking, {
      type: "agent.snapshot",
      snapshot: snapshot("succeeded", null),
    });

    expect(completed.thinking).toBeNull();
    expect(completed.thinkingBySession[firstSession.id]?.[stepId]).toBe(
      "First thought\nSecond thought",
    );
    const removed = desktopReducer(completed, {
      type: "session.deleted",
      sessionId: firstSession.id,
    });
    expect(removed.thinkingBySession[firstSession.id]).toBeUndefined();
  });

  it("keeps thinking that streams while another session is selected", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: secondSession,
    });
    const updated = desktopReducer(selected, {
      type: "agent.snapshot",
      snapshot: snapshot("running", "Background thought"),
    });

    expect(updated.activeSessionId).toBe(secondSession.id);
    expect(updated.thinkingBySession[firstSession.id]?.[stepId]).toBe("Background thought");
  });
});

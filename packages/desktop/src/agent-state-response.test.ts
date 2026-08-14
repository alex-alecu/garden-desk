import { AgentRunSnapshotSchema, SessionSummarySchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { desktopReducer, initialDesktopState } from "./state.js";

const timestamp = "2026-08-14T17:00:00.000Z";
const session = SessionSummarySchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  folderId: null,
  title: "Streaming",
  createdAt: timestamp,
  updatedAt: timestamp,
});

function snapshot(response: string) {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: "00000000-0000-4000-8000-000000000002",
      sessionId: session.id,
      jobId: "00000000-0000-4000-8000-000000000003",
      state: "running",
      response,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    artifacts: [],
  });
}

describe("agent response streaming", () => {
  it("adds one transient assistant row and replaces its text on each snapshot", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session,
    });
    const partial = desktopReducer(selected, {
      type: "agent.snapshot",
      snapshot: snapshot("## Res"),
    });
    const updated = desktopReducer(partial, {
      type: "agent.snapshot",
      snapshot: snapshot("## Result"),
    });

    expect(updated.timeline).toEqual([
      expect.objectContaining({
        kind: "assistant",
        runId: snapshot("unused").run.id,
        streaming: true,
        text: "## Result",
      }),
    ]);
  });
});

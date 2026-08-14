import { AgentRunSnapshotSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { type ActiveRun, withActiveRun } from "./service-active.js";

const timestamp = "2026-08-14T17:00:00.000Z";

describe("active agent response", () => {
  it("exposes transient text without changing the stored snapshot", () => {
    const snapshot = AgentRunSnapshotSchema.parse({
      run: {
        id: "00000000-0000-4000-8000-000000000001",
        sessionId: "00000000-0000-4000-8000-000000000002",
        jobId: "00000000-0000-4000-8000-000000000003",
        state: "running",
        response: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      events: [],
      artifacts: [],
    });
    const active: ActiveRun = {
      controller: new AbortController(),
      finished: Promise.resolve(),
      runId: snapshot.run.id,
      sessionId: snapshot.run.sessionId,
      thinking: null,
      response: "## Result\n\nStreaming",
    };

    expect(withActiveRun(snapshot, active).run.response).toBe("## Result\n\nStreaming");
    expect(snapshot.run.response).toBeNull();
  });
});

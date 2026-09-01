import { AgentRunSnapshotSchema } from "@gardendesk/shared";
import { describe, expect, it, vi } from "vitest";
import { retryLocalRequest, waitForAgentRun } from "./run-polling.js";

const timestamp = "2026-07-21T10:22:15.916Z";

function snapshot(state: "running" | "succeeded") {
  return AgentRunSnapshotSchema.parse({
    run: {
      id: "1f442abf-c966-4a8f-8097-8d43d2328fee",
      sessionId: "59ea570f-b5a7-4564-b47d-f3b19738d670",
      jobId: "02d70142-a222-425e-8556-ac853878e2f0",
      state,
      response: state === "succeeded" ? "Hello." : null,
      error: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    events: [],
    artifacts: [],
  });
}

describe("desktop agent polling", () => {
  it("recovers from a transient local bridge interruption", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce(snapshot("running"))
      .mockResolvedValueOnce(snapshot("succeeded"));
    const onSnapshot = vi.fn();
    const result = await waitForAgentRun({
      runId: "1f442abf-c966-4a8f-8097-8d43d2328fee",
      read,
      onSnapshot,
      pause: async () => undefined,
    });
    expect(result.run.state).toBe("succeeded");
    expect(read).toHaveBeenCalledTimes(3);
    expect(onSnapshot).toHaveBeenCalledTimes(2);
  });

  it("fails after three consecutive local request errors", async () => {
    const request = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(retryLocalRequest(request, async () => undefined)).rejects.toThrow("unavailable");
    expect(request).toHaveBeenCalledTimes(3);
  });
});

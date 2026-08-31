import { describe, expect, it } from "vitest";
import { activityRows, clusterEntries } from "./activity-rows.js";
import type { TimelineItem } from "./state-types.js";

const runId = "run-1";

function activity(partial: Partial<TimelineItem> & { id: string; text: string }): TimelineItem {
  return { createdAt: "2026-08-12T00:00:00.000Z", kind: "activity", runId, ...partial };
}

describe("activityRows", () => {
  it("merges a tool start and completion sharing a toolCallId into one row", () => {
    const rows = activityRows([
      activity({
        id: "s",
        eventType: "tool.started",
        toolCallId: "c1",
        toolName: "read",
        text: "Reading a",
      }),
      activity({
        id: "e",
        eventType: "tool.completed",
        toolCallId: "c1",
        toolName: "read",
        text: "Read a.",
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("done");
    expect(rows[0]?.title).toBe("Read a.");
  });

  it("marks a failed completion", () => {
    const rows = activityRows([
      activity({ id: "s", eventType: "tool.started", toolCallId: "c1", text: "Running ls" }),
      activity({
        id: "e",
        eventType: "tool.completed",
        toolCallId: "c1",
        text: "Running ls failed.",
      }),
    ]);
    expect(rows[0]?.status).toBe("failed");
  });

  it("keeps a running row shimmering until it completes", () => {
    const rows = activityRows([
      activity({ id: "s", eventType: "tool.started", toolCallId: "c1", text: "Reading a" }),
    ]);
    expect(rows[0]?.status).toBe("running");
  });

  it("adds transient thinking to its planning row", () => {
    const rows = activityRows(
      [activity({ id: "plan", eventType: "inference.started", text: "Planning the task." })],
      { plan: "First thought\nSecond thought" },
    );

    expect(rows[0]?.kind).toBe("thinking");
    expect(rows[0]?.detail).toBe("First thought\nSecond thought");
  });
});

describe("planning activity", () => {
  it("keeps its summary when no thinking arrived", () => {
    const rows = activityRows([
      activity({ id: "load", eventType: "inference.started", text: "Loading the model." }),
    ]);
    expect(rows[0]).toMatchObject({ kind: "tool", title: "Loading the model." });
  });
});

describe("clusterEntries", () => {
  it("groups consecutive same-run activity and keeps messages outside", () => {
    const entries = clusterEntries([
      { createdAt: "t0", id: "u", kind: "user", text: "hi" },
      activity({ id: "s", eventType: "tool.started", toolCallId: "c1", text: "Reading a" }),
      activity({ id: "e", eventType: "tool.completed", toolCallId: "c1", text: "Read a." }),
      { createdAt: "t1", id: "a", kind: "assistant", text: "done", runId },
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["item", "cluster", "item"]);
  });

  it("flags parallel sub-agents when two lanes overlap", () => {
    const entries = clusterEntries([
      activity({ id: "s1", eventType: "subagent.started", toolCallId: "t1", text: "Explore A" }),
      activity({ id: "s2", eventType: "subagent.started", toolCallId: "t2", text: "Explore B" }),
      activity({
        id: "e1",
        eventType: "subagent.completed",
        toolCallId: "t1",
        text: "Sub-agent completed.",
      }),
      activity({
        id: "e2",
        eventType: "subagent.completed",
        toolCallId: "t2",
        text: "Sub-agent completed.",
      }),
    ]);
    const cluster = entries.find((entry) => entry.kind === "cluster");
    expect(cluster?.kind === "cluster" && cluster.parallel).toBe(true);
  });

  it("does not flag sequential sub-agents", () => {
    const entries = clusterEntries([
      activity({ id: "s1", eventType: "subagent.started", toolCallId: "t1", text: "Explore A" }),
      activity({
        id: "e1",
        eventType: "subagent.completed",
        toolCallId: "t1",
        text: "Sub-agent completed.",
      }),
      activity({ id: "s2", eventType: "subagent.started", toolCallId: "t2", text: "Explore B" }),
      activity({
        id: "e2",
        eventType: "subagent.completed",
        toolCallId: "t2",
        text: "Sub-agent completed.",
      }),
    ]);
    const cluster = entries.find((entry) => entry.kind === "cluster");
    expect(cluster?.kind === "cluster" && cluster.parallel).toBe(false);
  });
});

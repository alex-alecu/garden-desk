import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityRow } from "./activity-rows.js";
import { ActivityCluster, openStateOnFinish } from "./components/activity-cluster.js";

const startedAt = "2026-08-12T12:00:00.000Z";

function row(partial: Partial<ActivityRow> & { id: string }): ActivityRow {
  return {
    kind: "tool",
    title: "Reading a",
    status: "done",
    toolName: "read",
    toolCallId: partial.id,
    detail: undefined,
    createdAt: startedAt,
    stepId: partial.id,
    ...partial,
  };
}

function renderCluster(props: {
  rows: ActivityRow[];
  working: boolean;
  failed: boolean;
  finishedDurationMs: number | undefined;
  forceExpandedRowId?: string;
}): string {
  return renderToStaticMarkup(
    <ActivityCluster
      failed={props.failed}
      finishedDurationMs={props.finishedDurationMs}
      forceExpandedRowId={props.forceExpandedRowId}
      onOpenDetails={() => undefined}
      parallel={false}
      rows={props.rows}
      runId="run"
      startedAt={startedAt}
      working={props.working}
    />,
  );
}

describe("openStateOnFinish", () => {
  it("collapses a clean finish and keeps a failed run expanded", () => {
    expect(openStateOnFinish(false)).toBe(false);
    expect(openStateOnFinish(true)).toBe(true);
  });
});

describe("ActivityCluster rendering", () => {
  const rows = [row({ id: "a" }), row({ id: "b", status: "running" })];

  it("stays expanded and non-toggleable while working", () => {
    const markup = renderCluster({
      rows,
      working: true,
      failed: false,
      finishedDurationMs: undefined,
    });
    expect(markup).toContain("Working for");
    expect(markup).toContain('class="activity-cluster-title"');
    expect(markup).not.toContain("activity-cluster-toggle");
  });

  it("mounts a failed run expanded so the failing row is visible", () => {
    const markup = renderCluster({
      rows,
      working: false,
      failed: true,
      finishedDurationMs: 4_000,
    });
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("failed");
  });

  it("only shimmers the running row", () => {
    const markup = renderCluster({
      rows,
      working: true,
      failed: false,
      finishedDurationMs: undefined,
    });
    expect(markup.match(/activity-row-shimmer/gu) ?? []).toHaveLength(1);
    expect(markup).toContain("activity-row activity-row-running");
    expect(markup).toContain("activity-row activity-row-done");
  });

  it("never shimmers a restored run whose planning rows never settled", () => {
    const planning: ActivityRow[] = [
      row({ id: "p", kind: "thinking", status: "running", title: "Choosing the next action." }),
      row({ id: "t", title: "Listed /workspace." }),
    ];
    const markup = renderCluster({
      rows: planning,
      working: false,
      failed: false,
      finishedDurationMs: 4_000,
      forceExpandedRowId: "p",
    });
    expect(markup).not.toContain("activity-row-shimmer");
    expect(markup).not.toContain("activity-row-running");
  });
});

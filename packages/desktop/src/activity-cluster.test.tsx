import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ActivityRow } from "./activity-rows.js";
import { ActivityCluster, openStateOnFinish } from "./components/activity-cluster.js";
import { followThinkingText } from "./thinking-scroll.js";

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

const settledRows = [row({ id: "a" }), row({ id: "b", status: "running" })];
const liveRows: ActivityRow[] = [
  row({ id: "p1", kind: "thinking", status: "running", title: "Choosing the next action." }),
  row({ id: "t1", title: "Listed /workspace." }),
  row({ id: "p2", kind: "thinking", status: "running", title: "Choosing the next action." }),
];
const restoredRows: ActivityRow[] = [
  row({ id: "p", kind: "thinking", status: "running", title: "Choosing the next action." }),
  row({ id: "t", title: "Listed /workspace." }),
];

describe("openStateOnFinish", () => {
  it("collapses a clean finish and keeps a failed run expanded", () => {
    expect(openStateOnFinish(false)).toBe(false);
    expect(openStateOnFinish(true)).toBe(true);
  });
});

describe("ActivityCluster rendering", () => {
  it("scrolls the timer header with the activity rows", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const headerRule = styles.match(/\.activity-cluster-header\s*\{([^}]*)\}/u)?.[1];

    expect(headerRule).not.toMatch(/position:\s*sticky/u);
  });

  it("stays expanded and non-toggleable while working", () => {
    const markup = renderCluster({
      rows: settledRows,
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
      rows: settledRows,
      working: false,
      failed: true,
      finishedDurationMs: 4_000,
    });
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("failed");
  });

  it("shimmers only the last row of a live run, even with earlier running rows", () => {
    const markup = renderCluster({
      rows: liveRows,
      working: true,
      failed: false,
      finishedDurationMs: undefined,
    });
    expect(markup.match(/activity-row-shimmer/gu) ?? []).toHaveLength(1);
    expect(markup.match(/activity-row activity-row-running/gu) ?? []).toHaveLength(1);
    expect(markup.match(/activity-row activity-row-done/gu) ?? []).toHaveLength(2);
  });

  it("never shimmers a restored run whose planning rows never settled", () => {
    const markup = renderCluster({
      rows: restoredRows,
      working: false,
      failed: false,
      finishedDurationMs: 4_000,
      forceExpandedRowId: "p",
    });
    expect(markup).not.toContain("activity-row-shimmer");
    expect(markup).not.toContain("activity-row-running");
  });
});

describe("thinking activity presentation", () => {
  it("opens a live thinking row and leaves it collapsed after the run", () => {
    const thinking = row({
      id: "p",
      detail: "First thought\nSecond thought",
      kind: "thinking",
      status: "running",
      title: "Planning the task.",
    });
    const liveMarkup = renderCluster({
      rows: [thinking],
      working: true,
      failed: false,
      finishedDurationMs: undefined,
    });
    const finishedMarkup = renderCluster({
      rows: [thinking],
      working: false,
      failed: false,
      finishedDurationMs: 4_000,
      forceExpandedRowId: "p",
    });

    expect(liveMarkup).toContain('aria-expanded="true"');
    expect(liveMarkup).toContain('class="activity-row-label activity-row-shimmer" disabled=""');
    expect(liveMarkup).toContain('class="thinking-log"');
    expect(liveMarkup).toContain('aria-label="Planning the task. details"');
    expect(liveMarkup).toContain('tabindex="0"');
    expect(liveMarkup).toContain("Second thought");
    expect(finishedMarkup).toContain('aria-expanded="false" class="activity-row-label"');
    expect(finishedMarkup).not.toContain("Second thought");
  });
});

describe("thinking text scrolling", () => {
  it("moves a thinking box to its last text row", () => {
    const viewer = { scrollHeight: 640, scrollTop: 0 };

    followThinkingText(viewer);

    expect(viewer.scrollTop).toBe(640);
  });
});

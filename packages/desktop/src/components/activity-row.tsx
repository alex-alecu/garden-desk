import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { ActivityRow } from "../activity-rows.js";
import { followThinkingText } from "../thinking-scroll.js";
import { Icon } from "./icons.js";

type IconName = Parameters<typeof Icon>[0]["name"];

function iconFor(row: ActivityRow): IconName {
  if (row.status === "failed") return "error";
  if (row.kind === "thinking") return "thinking";
  if (row.kind === "subagent") return "subagent";
  switch (row.toolName) {
    case "read":
      return "read";
    case "glob":
      return "glob";
    case "grep":
      return "search";
    case "list":
      return "list";
    case "write":
    case "edit":
      return "pencil";
    case "python":
    case "node":
      return "code";
    case "bash":
      return "terminal";
    case "skill":
      return "skill";
    default:
      return "activity";
  }
}

/**
 * One flat activity row: an icon, a verb-object label that shimmers while running, and an optional
 * inline detail preview. The label is a button so keyboard users can expand the detail; a separate
 * action opens the full evidence in the Technical Details Steps tab.
 */
export function ActivityRowView({
  row,
  onOpenDetails,
  live,
}: {
  row: ActivityRow;
  onOpenDetails(row: ActivityRow): void;
  live: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const detailViewer = useRef<HTMLPreElement>(null);
  const view = activityRowState(row, live, opened);
  useLayoutEffect(() => {
    if (view.liveThinking && detailViewer.current !== null)
      followThinkingText(detailViewer.current);
  });
  return (
    <div className={`activity-row activity-row-${view.visualStatus}`} data-kind={row.kind}>
      <span aria-hidden="true" className="activity-row-icon">
        <Icon name={iconFor(row)} />
      </span>
      <button
        aria-expanded={view.hasDetail ? view.expanded : undefined}
        className={`activity-row-label${view.shimmering ? " activity-row-shimmer" : ""}`}
        disabled={!view.canToggle}
        onClick={() => view.canToggle && setOpened((open) => !open)}
        type="button"
      >
        {row.title}
      </button>
      {view.expanded && view.hasDetail ? (
        <ActivityDetail
          liveThinking={view.liveThinking}
          onOpenDetails={onOpenDetails}
          row={row}
          viewer={detailViewer}
        />
      ) : null}
    </div>
  );
}

function activityRowState(row: ActivityRow, live: boolean, opened: boolean) {
  const hasDetail = row.detail !== undefined && row.detail.length > 0;
  const shimmering = live && row.status === "running";
  const liveThinking = live && row.kind === "thinking" && hasDetail;
  return {
    canToggle: hasDetail && !liveThinking,
    expanded: liveThinking || opened,
    hasDetail,
    liveThinking,
    shimmering,
    visualStatus: shimmering ? "running" : row.status === "running" ? "done" : row.status,
  };
}

function ActivityDetail({
  liveThinking,
  onOpenDetails,
  row,
  viewer,
}: {
  liveThinking: boolean;
  onOpenDetails(row: ActivityRow): void;
  row: ActivityRow;
  viewer: RefObject<HTMLPreElement | null>;
}) {
  return (
    <div className="activity-row-detail">
      <section aria-label={`${row.title} details`}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Overflowing activity detail needs a keyboard scroll target. */}
        <pre className={liveThinking ? "thinking-log" : undefined} ref={viewer} tabIndex={0}>
          {row.detail}
        </pre>
      </section>
      <button className="activity-row-open" onClick={() => onOpenDetails(row)} type="button">
        View in Technical details
      </button>
    </div>
  );
}

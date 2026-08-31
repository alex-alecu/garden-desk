import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { ActivityRow } from "../activity-rows.js";
import { followsThinkingText, followThinkingText } from "../thinking-scroll.js";
import { Icon } from "./icons.js";

type IconName = Parameters<typeof Icon>[0]["name"];
const UNAVAILABLE_THINKING =
  "Thinking text is kept only in memory until the app restarts, so it is not available.";

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
  const followsThinking = useRef(true);
  const view = activityRowState(row, live, opened);
  useLayoutEffect(() => {
    if (view.liveThinking && detailViewer.current !== null)
      followThinkingText(detailViewer.current, followsThinking.current);
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
        {view.title}
      </button>
      {view.expanded && view.detail !== undefined ? (
        <ActivityDetail
          detail={view.detail}
          onThinkingScroll={(viewer) => {
            followsThinking.current = followsThinkingText(viewer);
          }}
          onOpenDetails={onOpenDetails}
          row={row}
          thinking={row.kind === "thinking"}
          title={view.title}
          viewer={detailViewer}
        />
      ) : null}
    </div>
  );
}

function rowDetail(row: ActivityRow, live: boolean): string | undefined {
  if (row.detail !== undefined && row.detail.length > 0) return row.detail;
  return row.kind === "thinking" && !live ? UNAVAILABLE_THINKING : undefined;
}

function rowTitle(row: ActivityRow, live: boolean): string {
  return row.kind === "thinking" && !live && row.status === "running" ? "Thought" : row.title;
}

function activityRowState(row: ActivityRow, live: boolean, opened: boolean) {
  const detail = rowDetail(row, live);
  const hasDetail = detail !== undefined;
  const shimmering = live && row.status === "running";
  const liveThinking = live && row.kind === "thinking" && hasDetail;
  return {
    canToggle: hasDetail,
    detail,
    expanded: opened,
    hasDetail,
    liveThinking,
    shimmering,
    title: rowTitle(row, live),
    visualStatus: shimmering ? "running" : row.status === "running" ? "done" : row.status,
  };
}

// biome-ignore-start lint/a11y/noNoninteractiveTabindex: Overflowing activity detail needs a keyboard scroll target.
function ActivityDetail({
  detail,
  onThinkingScroll,
  onOpenDetails,
  row,
  thinking,
  title,
  viewer,
}: {
  detail: string;
  onThinkingScroll(viewer: HTMLPreElement): void;
  onOpenDetails(row: ActivityRow): void;
  row: ActivityRow;
  thinking: boolean;
  title: string;
  viewer: RefObject<HTMLPreElement | null>;
}) {
  return (
    <div className="activity-row-detail">
      <section aria-label={`${title} details`}>
        <pre
          tabIndex={0}
          className={thinking ? "thinking-log" : undefined}
          onScroll={thinking ? (event) => onThinkingScroll(event.currentTarget) : undefined}
          ref={viewer}
        >
          {detail}
        </pre>
      </section>
      <button className="activity-row-open" onClick={() => onOpenDetails(row)} type="button">
        View in Technical details
      </button>
    </div>
  );
}
// biome-ignore-end lint/a11y/noNoninteractiveTabindex: Overflowing activity detail needs a keyboard scroll target.

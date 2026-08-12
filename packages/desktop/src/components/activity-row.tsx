import { useState } from "react";
import type { ActivityRow } from "../activity-rows.js";
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
  const [expanded, setExpanded] = useState(false);
  const hasDetail = row.detail !== undefined && row.detail.length > 0;
  const shimmering = live && row.status === "running";
  const visualStatus = shimmering ? "running" : row.status === "running" ? "done" : row.status;
  return (
    <div className={`activity-row activity-row-${visualStatus}`} data-kind={row.kind}>
      <span aria-hidden="true" className="activity-row-icon">
        <Icon name={iconFor(row)} />
      </span>
      <button
        aria-expanded={hasDetail ? expanded : undefined}
        className={`activity-row-label${shimmering ? " activity-row-shimmer" : ""}`}
        disabled={!hasDetail}
        onClick={() => hasDetail && setExpanded((open) => !open)}
        type="button"
      >
        {row.title}
      </button>
      {expanded && hasDetail ? (
        <div className="activity-row-detail">
          <pre>{row.detail}</pre>
          <button className="activity-row-open" onClick={() => onOpenDetails(row)} type="button">
            View in Technical details
          </button>
        </div>
      ) : null}
    </div>
  );
}

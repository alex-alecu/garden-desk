import { useEffect, useRef, useState } from "react";
import type { ActivityRow } from "../activity-rows.js";
import { ActivityRowView } from "./activity-row.js";
import { Icon } from "./icons.js";

const VISIBLE_ROWS = 5;

export interface ClusterProps {
  runId: string;
  rows: ActivityRow[];
  parallel: boolean;
  working: boolean;
  failed: boolean;
  startedAt: string;
  finishedDurationMs: number | undefined;
  onOpenDetails(row: ActivityRow): void;
  forceExpandedRowId: string | undefined;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function useElapsedMs(startedAt: string, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return Math.max(0, now - new Date(startedAt).getTime());
}

function headerLabel(input: {
  working: boolean;
  failed: boolean;
  elapsedMs: number;
  finishedDurationMs: number | undefined;
}): string {
  const duration = formatDuration(input.finishedDurationMs ?? input.elapsedMs);
  if (input.working) return `Working for ${duration}`;
  if (input.failed) return `Stopped after ${duration} · failed`;
  return `Worked for ${duration}`;
}

function displayState(props: ClusterProps, open: boolean) {
  const elapsedMs = Math.max(
    0,
    new Date(props.rows.at(-1)?.createdAt ?? props.startedAt).getTime() -
      new Date(props.startedAt).getTime(),
  );
  const finishedDurationMs = props.finishedDurationMs ?? (props.working ? undefined : elapsedMs);
  const expanded = props.working || open;
  const visible = clusterRows(props.rows, props.working, expanded);
  return {
    expanded,
    hiddenCount: props.rows.length - visible.length,
    label: headerLabel({
      working: props.working,
      failed: props.failed,
      elapsedMs,
      finishedDurationMs,
    }),
    visible,
  };
}

/**
 * One agent run's activity, headed by a persistent timer line. While running it shows the last few
 * rows live; when finished it collapses to the timer line and expands on demand. A failed or
 * cancelled run stays expanded so the failing row is visible.
 */
export function ActivityCluster(props: ClusterProps) {
  const forcedOpen =
    props.forceExpandedRowId !== undefined &&
    props.rows.some((row) => row.id === props.forceExpandedRowId);
  const [open, setOpen] = useState(props.working || props.failed || forcedOpen);
  useEffect(() => {
    if (forcedOpen) setOpen(true);
  }, [forcedOpen]);
  const wasWorking = useRef(props.working);
  useEffect(() => {
    // Collapse to the timer line when a run finishes cleanly; a failed or cancelled run stays open.
    if (wasWorking.current && !props.working) setOpen(openStateOnFinish(props.failed));
    wasWorking.current = props.working;
  }, [props.working, props.failed]);
  const elapsedMs = useElapsedMs(props.startedAt, props.working);
  const display = displayState(
    { ...props, finishedDurationMs: props.working ? elapsedMs : props.finishedDurationMs },
    open,
  );
  return (
    <section aria-label="Agent activity" className="activity-cluster">
      <ClusterHeader
        canToggle={!props.working}
        expanded={display.expanded}
        label={display.label}
        onToggle={() => setOpen((value) => !value)}
        steps={props.rows.length}
      />
      {display.expanded ? (
        <div className="activity-cluster-rows">
          {props.parallel ? (
            <p className="activity-cluster-parallel">
              Running {parallelCount(props.rows)} tasks in parallel
            </p>
          ) : null}
          {display.hiddenCount > 0 ? (
            <p className="activity-cluster-earlier">{display.hiddenCount} earlier steps</p>
          ) : null}
          {display.visible.map((row) => (
            <ActivityRowView
              key={row.id}
              live={props.working}
              onOpenDetails={props.onOpenDetails}
              row={row}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ClusterHeader({
  canToggle,
  expanded,
  label,
  onToggle,
  steps,
}: {
  canToggle: boolean;
  expanded: boolean;
  label: string;
  onToggle(): void;
  steps: number;
}) {
  const text = canToggle ? `${label} · ${steps} step${steps === 1 ? "" : "s"}` : label;
  if (!canToggle) {
    return (
      <header className="activity-cluster-header">
        <span className="activity-cluster-title">{text}</span>
      </header>
    );
  }
  return (
    <header className="activity-cluster-header">
      <button
        aria-expanded={expanded}
        className="activity-cluster-toggle"
        onClick={onToggle}
        type="button"
      >
        <span aria-hidden="true" className={`activity-cluster-chevron${expanded ? " open" : ""}`}>
          <Icon name="activity" />
        </span>
        {text}
      </button>
    </header>
  );
}

function clusterRows(rows: ActivityRow[], working: boolean, expanded: boolean): ActivityRow[] {
  if (!expanded) return [];
  if (working && rows.length > VISIBLE_ROWS) return rows.slice(rows.length - VISIBLE_ROWS);
  return rows;
}

/**
 * The open state a cluster should take the moment a run stops working: a clean finish collapses to
 * the timer line, while a failed or cancelled run stays expanded so the failing row is visible.
 */
export function openStateOnFinish(failed: boolean): boolean {
  return failed;
}

function parallelCount(rows: ActivityRow[]): number {
  return Math.max(2, rows.filter((row) => row.kind === "subagent").length);
}

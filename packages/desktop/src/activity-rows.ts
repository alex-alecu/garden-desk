import type { TimelineItem } from "./state-types.js";

export type ActivityStatus = "running" | "done" | "failed";

export interface ActivityRow {
  id: string;
  kind: "tool" | "thinking" | "subagent";
  title: string;
  status: ActivityStatus;
  toolName: string | null | undefined;
  toolCallId: string | null | undefined;
  detail: string | undefined;
  createdAt: string;
  stepId: string;
}

export interface ActivityCluster {
  runId: string;
  rows: ActivityRow[];
  parallelSubagents: boolean;
}

const PLANNING_EVENTS = new Set(["inference.started"]);

function isSubagent(item: TimelineItem): boolean {
  return (
    item.toolName === "task" ||
    item.eventType === "subagent.started" ||
    item.eventType === "subagent.completed"
  );
}

function isToolPair(item: TimelineItem): boolean {
  return (
    item.eventType === "tool.started" ||
    item.eventType === "tool.completed" ||
    item.eventType === "execution.started" ||
    item.eventType === "execution.completed"
  );
}

function statusFor(eventType: TimelineItem["eventType"], failed: boolean): ActivityStatus {
  if (eventType === "tool.completed" || eventType === "subagent.completed") {
    return failed ? "failed" : "done";
  }
  if (eventType === "execution.completed") return failed ? "failed" : "done";
  return "running";
}

function failedText(item: TimelineItem): boolean {
  const summary = item.text.toLowerCase();
  return summary.includes("failed") || summary.includes("could not be completed");
}

function thinkingTitle(durationMs: number | undefined): string {
  if (durationMs === undefined) return "Thinking…";
  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  if (seconds < 60) return `Thought for ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  const minuteText = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  if (remaining === 0) return `Thought for ${minuteText}`;
  return `Thought for ${minuteText} ${remaining} ${remaining === 1 ? "second" : "seconds"}`;
}

/**
 * Folds one run's activity timeline into ordered rows. Tool and execution events that share a
 * `toolCallId` merge into a single row whose status advances from running to done/failed; planning
 * turns become "Thinking" rows; sub-agent events become lane rows. Detail from every merged event
 * is concatenated so the inline preview shows command, output, and termination together.
 */
export function activityRows(
  items: readonly TimelineItem[],
  thinkingByStep: Readonly<Record<string, string>> = {},
): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>();
  const order: string[] = [];
  for (const item of items) {
    if (item.eventType === undefined) continue;
    const key = rowKey(item);
    const existing = byKey.get(key);
    if (existing === undefined) {
      const row = newRow(key, item, thinkingByStep[item.id]);
      byKey.set(key, row);
      order.push(key);
    } else {
      mergeRow(existing, item);
    }
  }
  return order.map((key) => byKey.get(key)).filter((row): row is ActivityRow => row !== undefined);
}

function rowKey(item: TimelineItem): string {
  if (isSubagent(item)) return `subagent:${item.toolCallId ?? item.id}`;
  if (isToolPair(item) && item.toolCallId != null) return `tool:${item.toolCallId}`;
  if (PLANNING_EVENTS.has(item.eventType ?? "")) return `think:${item.id}`;
  return `event:${item.id}`;
}

function newRow(key: string, item: TimelineItem, thinking: string | undefined): ActivityRow {
  const kind = isSubagent(item)
    ? "subagent"
    : PLANNING_EVENTS.has(item.eventType ?? "")
      ? "thinking"
      : "tool";
  return {
    id: key,
    kind,
    title: kind === "thinking" ? thinkingTitle(item.durationMs) : item.text,
    status:
      kind === "thinking" && item.durationMs !== undefined
        ? "done"
        : statusFor(item.eventType, failedText(item)),
    toolName: item.toolName,
    toolCallId: item.toolCallId,
    detail: thinking ?? item.detail,
    createdAt: item.createdAt,
    stepId: item.id,
  };
}

function mergeRow(row: ActivityRow, item: TimelineItem): void {
  const failed = failedText(item);
  const next = statusFor(item.eventType, failed);
  // A running event never downgrades a settled row; a completed event always wins.
  if (next !== "running") row.status = next;
  if (item.eventType === "tool.completed" || item.eventType === "subagent.completed") {
    row.title = row.kind === "subagent" ? row.title : item.text;
  }
  if (item.detail !== undefined) {
    row.detail = row.detail === undefined ? item.detail : `${row.detail}\n\n${item.detail}`;
  }
}
export type ClusterEntry =
  | { kind: "cluster"; runId: string; rows: ActivityRow[]; parallel: boolean; createdAt: string }
  | { kind: "item"; item: TimelineItem };

/**
 * Groups consecutive activity items of the same run into one cluster entry and leaves every other
 * timeline item (user, assistant, other-run activity) as a standalone entry, so responses,
 * confirmations, and generated files always render outside the collapsed cluster.
 */
export function clusterEntries(
  items: readonly TimelineItem[],
  thinkingByStep: Readonly<Record<string, string>> = {},
): ClusterEntry[] {
  const entries: ClusterEntry[] = [];
  let bucket: TimelineItem[] = [];
  let runId: string | undefined;
  const flush = () => {
    if (bucket.length === 0 || runId === undefined) return;
    entries.push({
      kind: "cluster",
      runId,
      rows: activityRows(bucket, thinkingByStep),
      parallel: hasParallelSubagents(bucket),
      createdAt: bucket[0]?.createdAt ?? "",
    });
    bucket = [];
    runId = undefined;
  };
  for (const item of items) {
    if (item.kind === "activity" && item.runId != null) {
      if (runId !== undefined && runId !== item.runId) flush();
      runId = item.runId;
      bucket.push(item);
    } else {
      flush();
      entries.push({ kind: "item", item });
    }
  }
  flush();
  return entries;
}

/**
 * Detects whether two or more sub-agent lanes overlapped in time within a run: a lane opens on
 * `subagent.started` and closes on `subagent.completed`, so more than one open lane at any point
 * means the sub-agents ran in parallel.
 */
function hasParallelSubagents(items: readonly TimelineItem[]): boolean {
  let open = 0;
  let peak = 0;
  for (const item of items) {
    if (item.eventType === "subagent.started") open += 1;
    if (item.eventType === "subagent.completed") open = Math.max(0, open - 1);
    peak = Math.max(peak, open);
  }
  return peak >= 2;
}

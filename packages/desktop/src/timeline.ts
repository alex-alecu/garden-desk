import type { AgentEvent } from "@gardendesk/shared";
import type { TimelineItem } from "./state.js";

function bounded(label: string, value: string | null, limit: number): string | undefined {
  if (value === null || value.length === 0) return undefined;
  return `${label}:\n${value.length <= limit ? value : `${value.slice(0, limit)}\n… output truncated`}`;
}

function startedDetails(event: AgentEvent): Array<string | undefined> {
  return [
    bounded("Path", event.path, 1_000),
    bounded("Source", event.source, 12_000),
    bounded("Command", event.command, 12_000),
  ];
}

function completedDetails(event: AgentEvent): Array<string | undefined> {
  return [
    bounded("Output", event.stdout, 20_000),
    bounded("Error output", event.stderr, 20_000),
    event.exitCode === null ? undefined : `Exit code: ${event.exitCode}`,
    event.durationMs === null ? undefined : `Duration: ${event.durationMs} ms`,
    event.termination === null ? undefined : `Termination: ${event.termination}`,
  ];
}

function toolDetails(event: AgentEvent): Array<string | undefined> {
  return [
    event.toolName === null ? undefined : `Tool: ${event.toolName}`,
    event.toolCallId === null ? undefined : `Call ID: ${event.toolCallId}`,
  ];
}

function detailsForEvent(event: AgentEvent): Array<string | undefined> {
  switch (event.type) {
    case "execution.started":
      return startedDetails(event);
    case "execution.completed":
      return completedDetails(event);
    case "tool.started":
    case "subagent.started":
      return toolDetails(event);
    case "tool.completed":
    case "subagent.completed":
      return [...toolDetails(event), ...completedDetails(event)];
    default:
      return [];
  }
}

function eventDetail(event: AgentEvent): string | undefined {
  const items = detailsForEvent(event);
  const detail = items.filter((item): item is string => item !== undefined).join("\n\n");
  return detail.length === 0 ? undefined : detail;
}

export function eventItem(event: AgentEvent): TimelineItem {
  const detail = eventDetail(event);
  return {
    createdAt: event.createdAt,
    eventType: event.type,
    id: event.id,
    kind: "activity",
    runId: event.runId,
    sequence: event.sequence,
    text: event.summary,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    ...(event.durationMs === null ? {} : { durationMs: event.durationMs }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function subagentKey(event: AgentEvent): string | undefined {
  return event.toolCallId === null ? undefined : `${event.runId}:${event.toolCallId}`;
}

function collapsedSubagentDetail(started: TimelineItem, completed: AgentEvent): string {
  return [started.detail, `Result:\n${completed.summary}`, eventDetail(completed)]
    .filter((item): item is string => item !== undefined)
    .join("\n\n");
}

function collapseCompletedSubagent(
  items: TimelineItem[],
  starts: Map<string, number>,
  event: AgentEvent,
): boolean {
  const key = subagentKey(event);
  if (event.type !== "subagent.completed" || key === undefined) return false;
  const startIndex = starts.get(key);
  const started = startIndex === undefined ? undefined : items[startIndex];
  if (started === undefined || startIndex === undefined) return false;
  const toolName = event.toolName ?? started.toolName;
  items[startIndex] = {
    ...started,
    eventType: "subagent.completed",
    detail: collapsedSubagentDetail(started, event),
    ...(toolName === undefined ? {} : { toolName }),
  };
  return true;
}

export function eventItems(events: AgentEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  const subagents = new Map<string, number>();
  for (const event of events) {
    const key = subagentKey(event);
    if (event.type === "subagent.started" && key !== undefined) {
      subagents.set(key, items.length);
    }
    if (!collapseCompletedSubagent(items, subagents, event)) items.push(eventItem(event));
  }
  return items;
}

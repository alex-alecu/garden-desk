import type { AgentEvent } from "@vault/shared";
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

function eventDetail(event: AgentEvent): string | undefined {
  const items =
    event.type === "execution.started"
      ? startedDetails(event)
      : event.type === "execution.completed"
        ? completedDetails(event)
        : [];
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
    text: event.summary,
    ...(detail === undefined ? {} : { detail }),
  };
}

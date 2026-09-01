import type { AgentEventType, FolderSummary, SessionSummary } from "@gardendesk/shared";

export interface FolderGroup extends FolderSummary {
  sessions: SessionSummary[];
  expanded: boolean;
  nextCursor: string | null;
}

export interface TimelineItem {
  createdAt: string;
  eventType?: AgentEventType;
  id: string;
  kind: "user" | "assistant" | "activity";
  text: string;
  detail?: string;
  durationMs?: number;
  runId?: string | null;
  streaming?: boolean;
  sequence?: number;
  toolName?: string | null;
  toolCallId?: string | null;
}

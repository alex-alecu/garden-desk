import type { AgentEventType, FolderSummary, SessionSummary } from "@vault/shared";

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
  runId?: string | null;
  sequence?: number;
  toolName?: string | null;
  toolCallId?: string | null;
}

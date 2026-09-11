import type {
  AgentArtifactSummary,
  AgentRunPerformance,
  AgentRunSummary,
  AttachmentSummary,
} from "@gardendesk/shared";
import { useLayoutEffect, useRef } from "react";
import type { ArtifactSaveResult } from "../artifact-actions.js";
import type { TimelineItem } from "../state.js";
import { EmptyConversation } from "./empty-conversation.js";
import { attachmentsByUserMessage } from "./message-attachments.js";
import { type OrderedEntry, TimelineEntries } from "./timeline-entries.js";

interface ConversationProps {
  artifacts: AgentArtifactSummary[];
  attachments?: AttachmentSummary[];
  folderName?: string | undefined;
  ready: boolean;
  timeline: TimelineItem[];
  onSuggestion(text: string): void;
  onOpenAttachment?: ((attachmentId: string) => void) | undefined;
  onOpenArtifact?: ((artifact: AgentArtifactSummary) => Promise<void>) | undefined;
  onSaveArtifact?: ((artifact: AgentArtifactSummary) => Promise<ArtifactSaveResult>) | undefined;
  nativeActionMessage?: string | undefined;
  onSelectStep?: ((stepId: string | undefined) => void) | undefined;
  selectedStepId?: string | undefined;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
  thinkingByStep?: Readonly<Record<string, string>> | undefined;
  working?: boolean | undefined;
  activeRunState?: string | undefined;
  childRuns?: AgentRunSummary[];
  onOpenChild?: ((run: AgentRunSummary) => void) | undefined;
  hidden?: boolean;
}

const HIDDEN_CONVERSATION_EVENTS = new Set([
  "run.started",
  "assistant.completed",
  "question.asked",
  "question.answered",
]);

function showsInConversation(item: TimelineItem): boolean {
  return item.kind !== "activity" || !HIDDEN_CONVERSATION_EVENTS.has(item.eventType ?? "");
}

function conversationEntries(timeline: TimelineItem[]): OrderedEntry[] {
  const entries: OrderedEntry[] = timeline
    .filter(showsInConversation)
    .map((item, order) => ({ createdAt: item.createdAt, item, kind: "timeline", order }));
  return entries.sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.order - right.order,
  );
}

export function isNearConversationBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= 48;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one conversation composition boundary; entries and metrics live in timeline-entries.
export function Conversation({
  artifacts,
  attachments = [],
  folderName,
  ready,
  timeline,
  onSuggestion,
  onOpenAttachment = () => undefined,
  onOpenArtifact = async () => undefined,
  onSaveArtifact = async () => "failed",
  nativeActionMessage,
  onSelectStep = () => undefined,
  selectedStepId,
  performance,
  runId,
  thinkingByStep = {},
  working = false,
  activeRunState,
  childRuns = [],
  onOpenChild,
  hidden = false,
}: ConversationProps) {
  const entries = conversationEntries(timeline);
  const scrollContainer = useRef<HTMLElement>(null);
  const followsLatest = useRef(true);
  const savedScroll = useRef(0);
  const wasHidden = useRef(false);
  useLayoutEffect(() => {
    if (hidden) {
      wasHidden.current = true;
      return;
    }
    const container = scrollContainer.current;
    if (container === null) return;
    if (wasHidden.current) {
      container.scrollTop = savedScroll.current;
      wasHidden.current = false;
      return;
    }
    if (followsLatest.current) container.scrollTop = container.scrollHeight;
    savedScroll.current = container.scrollTop;
  });
  if (entries.length === 0) {
    return <EmptyConversation folderName={folderName} onSuggestion={onSuggestion} ready={ready} />;
  }
  const lastAssistantId = timeline.findLast((item) => item.kind === "assistant")?.id;
  return (
    <section
      aria-label="Conversation"
      aria-live="polite"
      className="conversation-scroll"
      hidden={hidden}
      onScroll={(event) => {
        if (hidden) return;
        const container = event.currentTarget;
        savedScroll.current = container.scrollTop;
        followsLatest.current = isNearConversationBottom(
          container.scrollTop,
          container.clientHeight,
          container.scrollHeight,
        );
      }}
      ref={scrollContainer}
    >
      <div className="timeline">
        <TimelineEntries
          artifacts={artifacts}
          childRuns={childRuns}
          onOpenChild={onOpenChild}
          attachmentsByMessage={attachmentsByUserMessage(timeline, attachments)}
          entries={entries}
          lastAssistantId={lastAssistantId}
          nativeActionMessage={nativeActionMessage}
          onOpenArtifact={onOpenArtifact}
          performance={performance}
          runId={runId}
          onOpenAttachment={onOpenAttachment}
          onSaveArtifact={onSaveArtifact}
          onSelectStep={onSelectStep}
          selectedStepId={selectedStepId}
          working={working}
          activeRunState={activeRunState}
          activeRunDurationMs={performance?.totalDurationMs}
          thinkingByStep={thinkingByStep}
        />
      </div>
    </section>
  );
}

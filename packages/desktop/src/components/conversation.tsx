import type { AgentArtifactSummary, AgentRunPerformance, AttachmentSummary } from "@vault/shared";
import { useLayoutEffect, useRef } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ContinuationQuestion } from "../continuation.js";
import type { TimelineItem } from "../state.js";
import { EmptyConversation } from "./empty-conversation.js";
import { attachmentsByUserMessage, MessageAttachments } from "./message-attachments.js";
import { QuestionTool } from "./question-tool.js";
import { RunProgress } from "./run-progress.js";

interface ConversationProps {
  artifacts: AgentArtifactSummary[];
  attachments?: AttachmentSummary[];
  folderName?: string | undefined;
  ready: boolean;
  timeline: TimelineItem[];
  onSuggestion(text: string): void;
  onOpenAttachment?: ((attachmentId: string) => void) | undefined;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
  thinking: string | null;
  working?: boolean | undefined;
  continuation?: ContinuationQuestion | undefined;
  onContinue?: (() => void) | undefined;
  onDismissContinuation?: (() => void) | undefined;
}

type OrderedEntry =
  | { createdAt: string; item: AgentArtifactSummary; kind: "artifact"; order: number }
  | { createdAt: string; item: TimelineItem; kind: "timeline"; order: number };

function showsInConversation(item: TimelineItem): boolean {
  return (
    item.kind !== "activity" ||
    (item.eventType !== "run.started" && item.eventType !== "assistant.completed")
  );
}

function conversationEntries(
  timeline: TimelineItem[],
  artifacts: AgentArtifactSummary[],
): OrderedEntry[] {
  const entries: OrderedEntry[] = timeline
    .filter(showsInConversation)
    .map((item, order) => ({ createdAt: item.createdAt, item, kind: "timeline", order }));
  entries.push(
    ...artifacts.map((item, index) => ({
      createdAt: item.createdAt,
      item,
      kind: "artifact" as const,
      order: timeline.length + index,
    })),
  );
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

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  return `${minutes}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

function ResponseMetrics({ performance }: { performance: AgentRunPerformance }) {
  return (
    <footer className="response-metrics">
      <span>
        <strong>{performance.promptTokensPerSecond.toFixed(1)}</strong> prompt tok/s
      </span>
      <span>
        <strong>{performance.tokensPerSecond.toFixed(1)}</strong> generation tok/s
      </span>
      <span>
        <strong>{formatDuration(performance.totalDurationMs)}</strong> total
      </span>
    </footer>
  );
}

// biome-ignore-start lint/a11y/noNoninteractiveTabindex: Overflowing tables need a keyboard scroll target.
const assistantMarkdownComponents: Components = {
  table({ children }) {
    return (
      <section aria-label="Response table" className="assistant-table-scroll" tabIndex={0}>
        <table>{children}</table>
      </section>
    );
  },
};
// biome-ignore-end lint/a11y/noNoninteractiveTabindex: Overflowing tables need a keyboard scroll target.

function AssistantResponse({ children }: { children: string }) {
  return (
    <div className="assistant-markdown">
      <Markdown
        components={assistantMarkdownComponents}
        disallowedElements={["a", "img"]}
        remarkPlugins={[remarkGfm]}
        skipHtml
        unwrapDisallowed
      >
        {children}
      </Markdown>
    </div>
  );
}

function ContinuationPrompt({
  continuation,
  onContinue,
  onDismissContinuation,
  ready,
}: Pick<ConversationProps, "continuation" | "onContinue" | "onDismissContinuation" | "ready">) {
  if (
    continuation === undefined ||
    onContinue === undefined ||
    onDismissContinuation === undefined
  ) {
    return null;
  }
  return (
    <QuestionTool
      disabled={!ready}
      filesDone={continuation.filesDone}
      filesTotal={continuation.filesTotal}
      onContinue={onContinue}
      onDismiss={onDismissContinuation}
    />
  );
}

function TimelineMessage({
  attachments,
  item,
  onOpenAttachment,
  showMetrics,
  performance,
}: {
  attachments: AttachmentSummary[];
  item: TimelineItem;
  onOpenAttachment(attachmentId: string): void;
  performance: AgentRunPerformance | null;
  showMetrics: boolean;
}) {
  return (
    <article className={`timeline-item timeline-${item.kind}`}>
      {item.kind === "assistant" ? (
        <AssistantResponse>{item.text}</AssistantResponse>
      ) : (
        <>
          <p>{item.text}</p>
          <MessageAttachments attachments={attachments} onOpenAttachment={onOpenAttachment} />
        </>
      )}
      {showMetrics && performance !== null ? <ResponseMetrics performance={performance} /> : null}
    </article>
  );
}

function TimelineEntries({
  attachmentsByMessage,
  entries,
  lastAssistantId,
  onOpenAttachment,
  performance,
  runId,
}: {
  attachmentsByMessage: Map<string, AttachmentSummary[]>;
  entries: OrderedEntry[];
  lastAssistantId: string | undefined;
  onOpenAttachment(attachmentId: string): void;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
}) {
  return entries.map((entry) => {
    if (entry.kind === "artifact") {
      return (
        <article className="timeline-item timeline-artifact" key={entry.item.id}>
          <span className="activity-label">Generated file</span>
          <p>{entry.item.name}</p>
        </article>
      );
    }
    const item = entry.item;
    const messageAttachments = attachmentsByMessage.get(item.id) ?? [];
    const showMetrics = item.id === lastAssistantId && item.runId === runId && performance !== null;
    return (
      <TimelineMessage
        attachments={messageAttachments}
        item={item}
        key={item.id}
        onOpenAttachment={onOpenAttachment}
        performance={performance}
        showMetrics={showMetrics}
      />
    );
  });
}

export function Conversation({
  artifacts,
  attachments = [],
  folderName,
  ready,
  timeline,
  onSuggestion,
  onOpenAttachment = () => undefined,
  performance,
  runId,
  thinking,
  working = false,
  continuation,
  onContinue,
  onDismissContinuation,
}: ConversationProps) {
  const entries = conversationEntries(timeline, artifacts);
  const scrollContainer = useRef<HTMLElement>(null);
  const followsLatest = useRef(true);
  useLayoutEffect(() => {
    const container = scrollContainer.current;
    if (container !== null && followsLatest.current) container.scrollTop = container.scrollHeight;
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
      onScroll={(event) => {
        const container = event.currentTarget;
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
          attachmentsByMessage={attachmentsByUserMessage(timeline, attachments)}
          entries={entries}
          lastAssistantId={lastAssistantId}
          performance={performance}
          runId={runId}
          onOpenAttachment={onOpenAttachment}
        />
        {thinking === null || thinking.length === 0 ? null : (
          <article className="thinking-stream">
            <header>
              <span aria-hidden="true" className="thinking-pulse" />
              Thinking locally
            </header>
            <p>{thinking}</p>
          </article>
        )}
        {working && (thinking === null || thinking.length === 0) ? (
          <RunProgress runId={runId} timeline={timeline} />
        ) : null}
        <ContinuationPrompt
          continuation={continuation}
          onContinue={onContinue}
          onDismissContinuation={onDismissContinuation}
          ready={ready}
        />
      </div>
    </section>
  );
}

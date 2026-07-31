import type { AgentArtifactSummary, AgentRunPerformance, AttachmentSummary } from "@vault/shared";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TimelineItem } from "../state.js";
import { MessageAttachments } from "./message-attachments.js";

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

export type OrderedEntry =
  | { createdAt: string; item: AgentArtifactSummary; kind: "artifact"; order: number }
  | { createdAt: string; item: TimelineItem; kind: "timeline"; order: number };

function ActivityStep({
  item,
  selected,
  onSelectStep,
}: {
  item: TimelineItem;
  selected: boolean;
  onSelectStep(stepId: string | undefined): void;
}) {
  return (
    <article className="timeline-item timeline-activity">
      <button
        aria-current={selected ? "step" : undefined}
        aria-label={`Show technical details for: ${item.text}`}
        className="activity-step"
        onClick={() => onSelectStep(selected ? undefined : item.id)}
        type="button"
      >
        {item.text}
      </button>
    </article>
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

export function TimelineEntries({
  attachmentsByMessage,
  entries,
  lastAssistantId,
  onOpenAttachment,
  onSelectStep,
  performance,
  runId,
  selectedStepId,
}: {
  attachmentsByMessage: Map<string, AttachmentSummary[]>;
  entries: OrderedEntry[];
  lastAssistantId: string | undefined;
  onOpenAttachment(attachmentId: string): void;
  onSelectStep(stepId: string | undefined): void;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
  selectedStepId: string | undefined;
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
    if (item.kind === "activity") {
      return (
        <ActivityStep
          item={item}
          key={item.id}
          onSelectStep={onSelectStep}
          selected={item.id === selectedStepId}
        />
      );
    }
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

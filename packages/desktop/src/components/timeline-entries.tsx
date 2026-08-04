import type { AgentArtifactSummary, AgentRunPerformance, AttachmentSummary } from "@vault/shared";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TimelineItem } from "../state.js";
import { GeneratedFiles } from "./generated-files.js";
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

export type OrderedEntry = {
  createdAt: string;
  item: TimelineItem;
  kind: "timeline";
  order: number;
};

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
  artifacts,
  nativeActionMessage,
  onOpenArtifact,
  onOpenAttachment,
  onSaveArtifact,
  showMetrics,
  performance,
}: {
  attachments: AttachmentSummary[];
  artifacts: AgentArtifactSummary[];
  item: TimelineItem;
  nativeActionMessage: string | undefined;
  onOpenArtifact(item: AgentArtifactSummary): Promise<void>;
  onOpenAttachment(attachmentId: string): void;
  onSaveArtifact(item: AgentArtifactSummary): Promise<boolean>;
  performance: AgentRunPerformance | null;
  showMetrics: boolean;
}) {
  return (
    <article className={`timeline-item timeline-${item.kind}`}>
      {item.kind === "assistant" ? (
        <>
          <AssistantResponse>{item.text}</AssistantResponse>
          <GeneratedFiles
            artifacts={artifacts}
            disabledReason={nativeActionMessage}
            onOpen={onOpenArtifact}
            onSave={onSaveArtifact}
          />
        </>
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
  artifacts,
  attachmentsByMessage,
  entries,
  lastAssistantId,
  nativeActionMessage,
  onOpenArtifact,
  onOpenAttachment,
  onSaveArtifact,
  onSelectStep,
  performance,
  runId,
  selectedStepId,
}: {
  artifacts: AgentArtifactSummary[];
  attachmentsByMessage: Map<string, AttachmentSummary[]>;
  entries: OrderedEntry[];
  lastAssistantId: string | undefined;
  nativeActionMessage: string | undefined;
  onOpenArtifact(item: AgentArtifactSummary): Promise<void>;
  onOpenAttachment(attachmentId: string): void;
  onSaveArtifact(item: AgentArtifactSummary): Promise<boolean>;
  onSelectStep(stepId: string | undefined): void;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
  selectedStepId: string | undefined;
}) {
  return entries.map((entry) => {
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
        artifacts={
          item.kind === "assistant" && item.runId !== null && item.runId !== undefined
            ? artifacts.filter((artifact) => artifact.runId === item.runId)
            : []
        }
        item={item}
        key={item.id}
        nativeActionMessage={nativeActionMessage}
        onOpenArtifact={onOpenArtifact}
        onOpenAttachment={onOpenAttachment}
        onSaveArtifact={onSaveArtifact}
        performance={performance}
        showMetrics={showMetrics}
      />
    );
  });
}

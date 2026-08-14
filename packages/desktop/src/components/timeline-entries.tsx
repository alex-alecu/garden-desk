import type { AgentArtifactSummary, AgentRunPerformance, AttachmentSummary } from "@vault/shared";
import { useEffect, useRef, useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { type ActivityRow, clusterEntries } from "../activity-rows.js";
import type { ArtifactSaveResult } from "../artifact-actions.js";
import type { TimelineItem } from "../state.js";
import { ActivityCluster } from "./activity-cluster.js";
import { GeneratedFiles } from "./generated-files.js";
import { Icon } from "./icons.js";
import { copyUserMessage, UserMessage } from "./user-message.js";

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

// biome-ignore-start lint/a11y/noNoninteractiveTabindex: Overflowing response content needs a keyboard scroll target.
const assistantMarkdownComponents: Components = {
  pre({ children }) {
    return (
      <section aria-label="Response code">
        <pre tabIndex={0}>{children}</pre>
      </section>
    );
  },
  table({ children }) {
    return (
      <section aria-label="Response table" className="assistant-table-scroll" tabIndex={0}>
        <table>{children}</table>
      </section>
    );
  },
};
// biome-ignore-end lint/a11y/noNoninteractiveTabindex: Overflowing response content needs a keyboard scroll target.

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

interface TimelineEntriesProps {
  artifacts: AgentArtifactSummary[];
  attachmentsByMessage: Map<string, AttachmentSummary[]>;
  entries: OrderedEntry[];
  lastAssistantId: string | undefined;
  nativeActionMessage: string | undefined;
  onOpenArtifact(item: AgentArtifactSummary): Promise<void>;
  onOpenAttachment(attachmentId: string): void;
  onSaveArtifact(item: AgentArtifactSummary): Promise<ArtifactSaveResult>;
  onSelectStep(stepId: string | undefined): void;
  performance: AgentRunPerformance | null;
  runId: string | undefined;
  selectedStepId: string | undefined;
  working: boolean;
  activeRunState: string | undefined;
  activeRunDurationMs: number | undefined;
  thinkingByStep: Readonly<Record<string, string>>;
}

function ResponseCopyButton({ text }: { text: string }) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await copyUserMessage(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  };
  const label = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy";
  return (
    <div className="response-actions">
      <button aria-label={`${label} response`} onClick={copy} title={label} type="button">
        <Icon name={copyState === "copied" ? "copy-check" : "copy"} />
        <span aria-live="polite">{copyState === "idle" ? "" : label}</span>
      </button>
    </div>
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
  onSaveArtifact(item: AgentArtifactSummary): Promise<ArtifactSaveResult>;
  performance: AgentRunPerformance | null;
  showMetrics: boolean;
}) {
  if (item.kind === "user") {
    return (
      <UserMessage attachments={attachments} item={item} onOpenAttachment={onOpenAttachment} />
    );
  }
  return (
    <article className={`timeline-item timeline-${item.kind}`}>
      <AssistantResponse>{item.text}</AssistantResponse>
      <GeneratedFiles
        artifacts={artifacts}
        disabledReason={nativeActionMessage}
        onOpen={onOpenArtifact}
        onSave={onSaveArtifact}
      />
      {item.kind === "assistant" ? <ResponseCopyButton text={item.text} /> : null}
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
  working,
  activeRunState,
  activeRunDurationMs,
  thinkingByStep,
}: TimelineEntriesProps) {
  return clusterEntries(
    entries.map((entry) => entry.item),
    thinkingByStep,
  ).map((entry) => (
    <TimelineEntry
      entry={entry}
      key={entry.kind === "cluster" ? `cluster-${entry.runId}-${entry.rows[0]?.id}` : entry.item.id}
      {...{
        artifacts,
        attachmentsByMessage,
        lastAssistantId,
        nativeActionMessage,
        onOpenArtifact,
        onOpenAttachment,
        onSaveArtifact,
        onSelectStep,
        performance,
        runId,
        selectedStepId,
        working,
        activeRunState,
        activeRunDurationMs,
        thinkingByStep,
      }}
    />
  ));
}

function TimelineEntry({
  entry,
  ...props
}: Omit<TimelineEntriesProps, "entries"> & { entry: ReturnType<typeof clusterEntries>[number] }) {
  if (entry.kind === "cluster") return <ActivityClusterEntry entry={entry} {...props} />;
  return <TimelineMessageEntry item={entry.item} {...props} />;
}

function ActivityClusterEntry({
  entry,
  activeRunDurationMs,
  activeRunState,
  onSelectStep,
  runId,
  selectedStepId,
  working,
}: Pick<
  TimelineEntriesProps,
  "activeRunDurationMs" | "activeRunState" | "onSelectStep" | "runId" | "selectedStepId" | "working"
> & { entry: Extract<ReturnType<typeof clusterEntries>[number], { kind: "cluster" }> }) {
  const active = entry.runId === runId;
  const failed = active && (activeRunState === "failed" || activeRunState === "cancelled");
  const selected = entry.rows.find((row) => row.stepId === selectedStepId)?.id;
  return (
    <ActivityCluster
      failed={failed}
      finishedDurationMs={active && !working ? activeRunDurationMs : undefined}
      forceExpandedRowId={selected}
      onOpenDetails={(row: ActivityRow) => onSelectStep(row.stepId)}
      parallel={entry.parallel}
      rows={entry.rows}
      runId={entry.runId}
      startedAt={entry.createdAt}
      working={active && working}
    />
  );
}

function TimelineMessageEntry({
  artifacts,
  attachmentsByMessage,
  item,
  lastAssistantId,
  nativeActionMessage,
  onOpenArtifact,
  onOpenAttachment,
  onSaveArtifact,
  performance,
  runId,
}: Pick<
  TimelineEntriesProps,
  | "artifacts"
  | "attachmentsByMessage"
  | "lastAssistantId"
  | "nativeActionMessage"
  | "onOpenArtifact"
  | "onOpenAttachment"
  | "onSaveArtifact"
  | "performance"
  | "runId"
> & { item: TimelineItem }) {
  const showMetrics = item.id === lastAssistantId && item.runId === runId && performance !== null;
  const responseArtifacts =
    item.kind === "assistant" && item.runId != null
      ? artifacts.filter((artifact) => artifact.runId === item.runId)
      : [];
  return (
    <TimelineMessage
      attachments={attachmentsByMessage.get(item.id) ?? []}
      artifacts={responseArtifacts}
      item={item}
      nativeActionMessage={nativeActionMessage}
      onOpenArtifact={onOpenArtifact}
      onOpenAttachment={onOpenAttachment}
      onSaveArtifact={onSaveArtifact}
      performance={performance}
      showMetrics={showMetrics}
    />
  );
}

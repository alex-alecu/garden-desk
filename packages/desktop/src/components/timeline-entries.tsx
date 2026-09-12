import type {
  AgentArtifactSummary,
  AgentRunPerformance,
  AgentRunSummary,
  AttachmentSummary,
} from "@gardendesk/shared";
import { type ActivityRow, clusterEntries } from "../activity-rows.js";
import type { ArtifactSaveResult } from "../artifact-actions.js";
import type { TimelineItem } from "../state.js";
import { ActivityCluster } from "./activity-cluster.js";
import { TimelineMessage } from "./timeline-message.js";

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
  childRuns?: AgentRunSummary[] | undefined;
  onOpenChild?: ((run: AgentRunSummary) => void) | undefined;
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
  childRuns,
  onOpenChild,
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
        childRuns,
        onOpenChild,
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
  childRuns,
  onOpenChild,
}: Pick<
  TimelineEntriesProps,
  | "activeRunDurationMs"
  | "activeRunState"
  | "onSelectStep"
  | "runId"
  | "selectedStepId"
  | "working"
  | "childRuns"
  | "onOpenChild"
> & { entry: Extract<ReturnType<typeof clusterEntries>[number], { kind: "cluster" }> }) {
  const active = entry.runId === runId;
  const failed = active && (activeRunState === "failed" || activeRunState === "cancelled");
  const selected = entry.rows.find((row) => row.stepId === selectedStepId)?.id;
  return (
    <ActivityCluster
      childRuns={childRuns?.filter(
        (run) =>
          run.parentRunId === entry.runId &&
          entry.rows.some((row) => row.toolCallId === run.parentToolCallId),
      )}
      onOpenChild={onOpenChild}
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

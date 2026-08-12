import type { AgentArtifactSummary, AgentExecutionSnapshot } from "@vault/shared";
import { type ActivityRow, type ClusterEntry, clusterEntries } from "./activity-rows.js";
import type { TimelineItem } from "./state.js";

const CODE_TOOLS = new Set(["bash", "python", "node"]);

export interface TranscriptInput {
  sessionId: string;
  title: string;
  timeline: TimelineItem[];
  executions: AgentExecutionSnapshot[];
  artifacts: AgentArtifactSummary[];
}

/**
 * Renders one session as Markdown from data already loaded in desktop state: conversation
 * messages, folded activity steps with their code and output, and generated files. It fetches
 * nothing, so recorded model prompts are out of scope and per-event caps are preserved verbatim.
 */
export function sessionTranscript(input: TranscriptInput): string {
  const ordered = [...input.timeline].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const cursors = executionCursors(input.executions);
  const sections = clusterEntries(conversationItems(ordered)).map((entry) =>
    entry.kind === "item"
      ? messageSection(entry.item, input.artifacts)
      : clusterSection(entry, cursors),
  );
  return `${[heading(input), ...sections].filter((section) => section.length > 0).join("\n\n")}\n`;
}

export function transcriptHasContent(timeline: TimelineItem[]): boolean {
  return conversationItems(timeline).length > 0;
}

function conversationItems(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.filter(
    (item) =>
      item.kind !== "activity" ||
      (item.eventType !== "run.started" && item.eventType !== "assistant.completed"),
  );
}

function heading(input: TranscriptInput): string {
  return `# ${input.title}\n\n**Session ID:** ${input.sessionId}`;
}

function messageSection(item: TimelineItem, artifacts: AgentArtifactSummary[]): string {
  if (item.kind === "user") return `## You\n\n${item.text}`;
  if (item.kind === "assistant") {
    const files = generatedFilesSection(artifacts, item.runId);
    const body = files.length === 0 ? item.text : `${item.text}\n\n${files}`;
    return `## Assistant\n\n${body}`;
  }
  return `## Note\n\n${item.text}`;
}

type ExecutionCursor = { next(runId: string): AgentExecutionSnapshot | undefined };

function clusterSection(
  entry: Extract<ClusterEntry, { kind: "cluster" }>,
  cursors: ExecutionCursor,
): string {
  return entry.rows
    .map((row, index) => stepSection(row, index + 1, entry.runId, cursors))
    .join("\n\n");
}

const STATUS_LABEL = { running: "in progress", done: "done", failed: "failed" } as const;

function stepSection(
  row: ActivityRow,
  ordinal: number,
  runId: string,
  cursors: ExecutionCursor,
): string {
  const header = `### Step ${ordinal} · ${row.title} — ${STATUS_LABEL[row.status]}`;
  const execution = CODE_TOOLS.has(row.toolName ?? "") ? cursors.next(runId) : undefined;
  const body =
    execution !== undefined
      ? executionBody(execution)
      : row.detail === undefined
        ? ""
        : fence(row.detail);
  return body.length === 0 ? header : `${header}\n\n${body}`;
}

function executionBody(execution: AgentExecutionSnapshot): string {
  const source = execution.source ?? execution.command ?? "";
  const parts = [
    source.length === 0 ? "" : fence(source, execution.language),
    execution.stdout.length === 0 ? "" : `Output:\n\n${fence(execution.stdout)}`,
    execution.stderr.length === 0 ? "" : `Errors:\n\n${fence(execution.stderr)}`,
    metaLine(execution),
  ];
  return parts.filter((part) => part.length > 0).join("\n\n");
}

function metaLine(execution: AgentExecutionSnapshot): string {
  return [
    `Exit code: ${execution.exitCode ?? "n/a"}`,
    `Duration: ${execution.durationMs === null ? "n/a" : `${execution.durationMs} ms`}`,
    `Termination: ${execution.termination ?? "n/a"}`,
  ].join(" · ");
}

function generatedFilesSection(
  artifacts: AgentArtifactSummary[],
  runId: string | null | undefined,
): string {
  const files = runId == null ? [] : artifacts.filter((artifact) => artifact.runId === runId);
  if (files.length === 0) return "";
  const lines = files.map((file) => `- ${file.name} · ${fileSize(file.byteLength)}`);
  return `### Generated files\n\n${lines.join("\n")}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function fence(content: string, language = ""): string {
  const longestRun = content.match(/`+/gu)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0;
  const ticks = "`".repeat(Math.max(3, longestRun + 1));
  return `${ticks}${language}\n${content}\n${ticks}`;
}

function executionCursors(executions: AgentExecutionSnapshot[]): ExecutionCursor {
  const byRun = new Map<string, AgentExecutionSnapshot[]>();
  for (const execution of [...executions].sort((left, right) => left.sequence - right.sequence)) {
    const list = byRun.get(execution.runId) ?? [];
    list.push(execution);
    byRun.set(execution.runId, list);
  }
  const consumed = new Map<string, number>();
  return {
    next(runId) {
      const list = byRun.get(runId);
      const index = consumed.get(runId) ?? 0;
      if (list === undefined || index >= list.length) return undefined;
      consumed.set(runId, index + 1);
      return list[index];
    },
  };
}

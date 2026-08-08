import type { AgentEvent, AgentRunState, ConversationMessage } from "@vault/shared";
import type { DatabasePort } from "../workspace/database.js";
import { type EventRow, eventFromRow, type RunRow, runFromRow } from "./records.js";

export interface HistoricalRun {
  state: AgentRunState;
  events: AgentEvent[];
}

export interface DurableAgentHistory {
  messages: ConversationMessage[];
  runs: HistoricalRun[];
  /**
   * Anchored continuity prose for turns that no longer fit verbatim. It replaces a
   * bare omitted-message count and never carries authoritative values.
   */
  summary?: string | undefined;
}

function tokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function bounded(text: string, maximumTokens: number): string {
  const maximumCharacters = Math.max(0, maximumTokens * 4);
  if (text.length <= maximumCharacters) return text;
  return `${text.slice(0, Math.max(0, maximumCharacters - 24))}\n[durable log omitted]`;
}

function eventText(event: AgentEvent, complete: boolean, excerptTokens = 256): string {
  const detail = {
    eventId: event.id,
    runId: event.runId,
    type: event.type,
    summary: event.summary,
    language: event.language,
    path: event.path,
    source: complete ? event.source : bounded(event.source ?? "", excerptTokens),
    command: complete ? event.command : bounded(event.command ?? "", excerptTokens),
    exitCode: event.exitCode,
    durationMs: event.durationMs,
    termination: event.termination,
    stdout: complete ? event.stdout : bounded(event.stdout ?? "", excerptTokens),
    stderr: complete ? event.stderr : bounded(event.stderr ?? "", excerptTokens),
  };
  return JSON.stringify(detail);
}

function repairKey(event: AgentEvent): string {
  return event.path === null ? String(event.language) : `${event.language}:${event.path}`;
}

export function executionSucceeded(event: AgentEvent): boolean {
  return event.termination === "completed" && event.exitCode === 0;
}

function updateRepairChains(chains: Map<string, AgentEvent[]>, event: AgentEvent): void {
  if (event.type !== "execution.completed") return;
  const key = repairKey(event);
  if (executionSucceeded(event)) {
    chains.delete(key);
    return;
  }
  const chain = [...(chains.get(key) ?? []), event];
  chains.delete(key);
  chains.set(key, chain);
}

function incompleteRepair(run: HistoricalRun): AgentEvent[] | undefined {
  if (run.state !== "failed") return undefined;
  let pending: AgentEvent | undefined;
  for (const event of run.events) {
    if (event.type === "execution.started") pending = event;
    if (event.type === "execution.completed") pending = undefined;
  }
  if (pending === undefined) return undefined;
  return [pending, ...run.events.filter((event) => event.type === "run.failed").slice(-1)];
}

function failedRepairEvents(history: DurableAgentHistory): AgentEvent[] {
  const chains = new Map<string, AgentEvent[]>();
  for (const run of history.runs) {
    for (const event of run.events) updateRepairChains(chains, event);
    const incomplete = incompleteRepair(run);
    if (incomplete === undefined) continue;
    const key = repairKey(incomplete[0] as AgentEvent);
    chains.set(key, [...(chains.get(key) ?? []), ...incomplete]);
  }
  return [...chains.values()].at(-1) ?? [];
}

function recentConversation(history: DurableAgentHistory, budgetTokens: number) {
  const lines: string[] = [];
  let used = 0;
  let userTurns = 0;
  let start = history.messages.length;
  for (let index = history.messages.length - 1; index >= 0; index -= 1) {
    const message = history.messages[index] as ConversationMessage;
    if (message.role === "user" && userTurns === 2) break;
    const line = `${message.role}: ${message.content}`;
    const size = tokens(line);
    if (used + size > budgetTokens) break;
    lines.unshift(line);
    start = index;
    used += size;
    if (message.role === "user") userTurns += 1;
  }
  return { lines, start, tokens: used };
}

function compactMessages(messages: ConversationMessage[], excerptTokens: number) {
  const lines = messages.map(
    (message) =>
      `message ${message.id} ${message.role}: ${bounded(message.content, excerptTokens)}`,
  );
  return { lines, tokens: tokens(lines.join("\n")) };
}

function anchoredSummary(summary: string | undefined, budgetTokens: number) {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const lines = [summary.trim()];
  const used = tokens(lines[0] as string);
  return used <= budgetTokens ? { lines, tokens: used, anchored: true } : undefined;
}

function olderConversation(
  messages: ConversationMessage[],
  budgetTokens: number,
  summary?: string,
) {
  for (const excerptTokens of [128, 64, 32, 16, 8]) {
    const compacted = compactMessages(messages, excerptTokens);
    if (compacted.tokens <= budgetTokens) return { ...compacted, anchored: false };
  }
  const anchored = anchoredSummary(summary, budgetTokens);
  if (anchored !== undefined) return anchored;
  const marker = `${messages.length} older messages remain in durable conversation history.`;
  return tokens(marker) <= budgetTokens
    ? { lines: [marker], tokens: tokens(marker), anchored: false }
    : { lines: [], tokens: 0, anchored: false };
}

function olderRunSummaries(
  history: DurableAgentHistory,
  protectedEvents: Set<AgentEvent>,
  budgetTokens: number,
): { lines: string[]; tokens: number } {
  for (const excerptTokens of [256, 128, 64, 32, 8]) {
    const summaries = history.runs.flatMap((run) => {
      const events = run.events.filter((event) => !protectedEvents.has(event));
      return events.length === 0
        ? []
        : [
            `run ${run.state}: ${events.map((event) => eventText(event, false, excerptTokens)).join(" ")}`,
          ];
    });
    const used = tokens(summaries.join("\n"));
    if (used <= budgetTokens) return { lines: summaries, tokens: used };
  }
  const count = history.runs
    .flatMap((run) => run.events)
    .filter((event) => !protectedEvents.has(event)).length;
  const marker = `${count} older events remain in durable execution history.`;
  return tokens(marker) <= budgetTokens
    ? { lines: [marker], tokens: tokens(marker) }
    : { lines: [], tokens: 0 };
}

export function assembleHistory(
  history: DurableAgentHistory | undefined,
  budgetTokens: number,
): string {
  if (history === undefined || budgetTokens <= 0) return "";
  const recentBudget = Math.min(8_000, Math.max(2_000, Math.floor(budgetTokens * 0.25)));
  const recent = recentConversation(history, recentBudget);
  const repair = failedRepairEvents(history);
  const repairText = repair.map((event) => eventText(event, true)).join("\n");
  const required = tokens(repairText) + recent.tokens;
  if (required > budgetTokens) throw new Error("agent_context_exhausted");
  const remaining = budgetTokens - required;
  const summaries = olderRunSummaries(history, new Set(repair), Math.floor(remaining * 0.65));
  const older = olderConversation(
    history.messages.slice(0, recent.start),
    remaining - summaries.tokens,
    history.summary,
  );
  return [
    older.lines.length === 0
      ? ""
      : `${older.anchored ? "Anchored summary of earlier turns" : "Older conversation summary"}:\n${older.lines.join("\n")}`,
    summaries.lines.length === 0 ? "" : `Older execution summary:\n${summaries.lines.join("\n")}`,
    repairText.length === 0 ? "" : `Newest unsuperseded failed execution:\n${repairText}`,
    recent.lines.length === 0 ? "" : `Recent conversation:\n${recent.lines.join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function historyForSession(
  database: DatabasePort,
  sessionId: string,
  excludeRunId: string,
): HistoricalRun[] {
  const runs = database
    .prepare("SELECT * FROM agent_runs WHERE session_id = ? AND id <> ? ORDER BY created_at, id")
    .all(sessionId, excludeRunId) as RunRow[];
  return runs.map((run) => ({
    state: runFromRow(run).state,
    events: (
      database
        .prepare("SELECT * FROM agent_events WHERE run_id = ? ORDER BY sequence")
        .all(run.id) as EventRow[]
    ).map(eventFromRow),
  }));
}

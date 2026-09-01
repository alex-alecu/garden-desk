import type { AgentRunSnapshot } from "@gardendesk/shared";
import type { PendingQuestion } from "./agent-questions.js";
import type { AgentStore } from "./store.js";

export interface ActiveRun {
  controller: AbortController;
  finished: Promise<void>;
  runId: string;
  sessionId: string;
  thinking: string | null;
  response: string | null;
  contextUsedTokens?: number | null;
  contextAllocatedTokens?: number | null;
  question?: PendingQuestion | null;
}

export function withActiveRun(snapshot: AgentRunSnapshot, active: ActiveRun | undefined) {
  return {
    ...snapshot,
    run: active === undefined ? snapshot.run : { ...snapshot.run, response: active.response },
    thinking: active?.thinking ?? null,
    contextUsedTokens: active?.contextUsedTokens ?? snapshot.contextUsedTokens,
    contextAllocatedTokens: active?.contextAllocatedTokens ?? snapshot.contextAllocatedTokens,
    question: active?.question?.request ?? null,
  };
}

export function activeRunSnapshot(
  store: Pick<AgentStore, "snapshot">,
  activeRuns: Iterable<ActiveRun>,
  runId: string,
): AgentRunSnapshot {
  const active = [...activeRuns].find((run) => run.runId === runId);
  return withActiveRun(store.snapshot(runId), active);
}

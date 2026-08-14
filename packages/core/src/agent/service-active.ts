import type { AgentRunSnapshot } from "@vault/shared";
import type { PendingQuestion } from "./agent-questions.js";

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

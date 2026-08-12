export interface ActiveRun {
  controller: AbortController;
  finished: Promise<void>;
  runId: string;
  sessionId: string;
  thinking: string | null;
  contextUsedTokens?: number | null;
  contextAllocatedTokens?: number | null;
}

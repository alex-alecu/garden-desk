import {
  type AgentExecutionSnapshot,
  type AgentRunSummary,
  parseWorkProgress,
  workContinuationMessage,
} from "@vault/shared";
import { useState } from "react";

export interface ContinuationQuestion {
  done: number;
  total: number;
  runId: string;
}

export function continuationQuestion(
  run: AgentRunSummary | undefined,
  executions: AgentExecutionSnapshot[],
): ContinuationQuestion | undefined {
  if (run?.state !== "succeeded" || run.response === null) return undefined;
  const progress = executions
    .filter((execution) => execution.runId === run.id && execution.state === "completed")
    .sort((left, right) => left.sequence - right.sequence)
    .map((execution) => parseWorkProgress(execution.stdout))
    .filter((item) => item !== undefined && !item.complete)
    .at(-1);
  if (progress === undefined || run.response !== workContinuationMessage(progress))
    return undefined;
  return { runId: run.id, done: progress.done, total: progress.total };
}

export function useContinuationQuestion(
  run: AgentRunSummary | undefined,
  executions: AgentExecutionSnapshot[],
  start: (task: string) => void,
) {
  const [dismissedRuns, setDismissedRuns] = useState<Set<string>>(() => new Set());
  const available = continuationQuestion(run, executions);
  if (available === undefined || dismissedRuns.has(available.runId)) return {};
  const dismiss = () => setDismissedRuns((current) => new Set(current).add(available.runId));
  return {
    continuation: available,
    onContinue: () => {
      dismiss();
      start("Continue");
    },
    onDismissContinuation: dismiss,
  };
}

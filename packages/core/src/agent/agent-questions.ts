import { randomUUID } from "node:crypto";
import {
  type AgentQuestion,
  AgentQuestionAnswerSchema,
  AgentQuestionIdSchema,
  type AgentQuestionRequest,
  AgentQuestionRequestSchema,
} from "@vault/shared";
import type { AgentQuestionOutcome } from "./generic-tool-support.js";
import type { ActiveRun } from "./service-active.js";
import type { AgentStore } from "./store.js";

/**
 * A question the primary run is currently blocked on. The run's tool call awaits {@link settle}
 * until the user answers, dismisses, or the run is aborted. Pending questions live only in memory:
 * a Core restart fails the run through the ordinary interrupted-run recovery path.
 */
export interface PendingQuestion {
  readonly request: AgentQuestionRequest;
  settle(outcome: AgentQuestionOutcome): boolean;
}

interface CreatedQuestion {
  pending: PendingQuestion;
  answered: Promise<AgentQuestionOutcome>;
}

export function createPendingQuestion(runId: string, questions: AgentQuestion[]): CreatedQuestion {
  const request = AgentQuestionRequestSchema.parse({
    id: AgentQuestionIdSchema.parse(randomUUID()),
    runId,
    questions,
    createdAt: new Date().toISOString(),
  });
  let resolve: (outcome: AgentQuestionOutcome) => void = () => undefined;
  let settled = false;
  const answered = new Promise<AgentQuestionOutcome>((accept) => {
    resolve = accept;
  });
  const settle = (outcome: AgentQuestionOutcome): boolean => {
    if (settled) return false;
    settled = true;
    resolve(outcome);
    return true;
  };
  return { pending: { request, settle }, answered };
}

/** The labels the answered question resolved with, joined for durable event evidence. */
export function answeredLabels(outcome: AgentQuestionOutcome): string {
  if (outcome.dismissed) return "dismissed";
  return outcome.answers
    .map((answer) => (answer.length > 0 ? answer.join(", ") : "unanswered"))
    .join(" | ");
}

export async function askRunQuestion(input: {
  active: Map<string, ActiveRun>;
  store: AgentStore;
  run: { id: string; jobId: string };
  signal: AbortSignal;
  questions: AgentQuestion[];
}): Promise<AgentQuestionOutcome> {
  const { active, store, run, signal, questions } = input;
  const current = active.get(run.jobId);
  if (current?.runId !== run.id) throw new Error("active_run_missing");
  if (current.question != null) throw new Error("question_already_pending");
  const { pending, answered } = createPendingQuestion(run.id, questions);
  const onAbort = () => pending.settle({ dismissed: true });
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  current.question = pending;
  try {
    signal.throwIfAborted();
    store.appendEvent(run.id, "question.asked", "Waiting for your answer.");
    const outcome = await answered;
    signal.throwIfAborted();
    store.appendEvent(run.id, "question.answered", "Question answered.", {
      stdout: answeredLabels(outcome),
    });
    return outcome;
  } finally {
    signal.removeEventListener("abort", onAbort);
    pending.settle({ dismissed: true });
    if (current.question === pending) current.question = null;
  }
}

export function settleRunQuestion(
  active: ReadonlyMap<string, ActiveRun>,
  runId: string,
  questionId: string,
  outcome: AgentQuestionOutcome,
): boolean {
  const run = [...active.values()].find((item) => item.runId === runId);
  if (run?.question?.request.id !== questionId) return false;
  if (outcome.dismissed) return run.question.settle(outcome);
  const parsed = AgentQuestionAnswerSchema.array()
    .length(run.question.request.questions.length)
    .safeParse(outcome.answers);
  if (!parsed.success) return false;
  if (
    parsed.data.some(
      (answer, index) =>
        run.question?.request.questions[index]?.multiple !== true && answer.length > 1,
    )
  ) {
    return false;
  }
  return run.question.settle({ dismissed: false, answers: parsed.data });
}

export function settleActiveQuestion(
  active: ReadonlyMap<string, ActiveRun>,
  runId: string,
  questionId: string,
  answers?: string[][],
): boolean {
  return settleRunQuestion(
    active,
    runId,
    questionId,
    answers === undefined ? { dismissed: true } : { dismissed: false, answers },
  );
}

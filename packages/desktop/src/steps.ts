import type { AgentExecutionSnapshot, AgentInferenceTurn, AgentTrace } from "@vault/shared";
import type { TimelineItem } from "./state.js";

export interface AgentStep {
  id: string;
  runId: string | null;
  ordinal: number;
  kind: "planning" | "execution" | "outcome";
  title: string;
  detail?: string;
  execution?: AgentExecutionSnapshot;
  turn?: AgentInferenceTurn;
}

const HIDDEN_EVENTS = new Set(["run.started", "assistant.completed"]);

function stepKind(item: TimelineItem): AgentStep["kind"] {
  if (item.eventType === "inference.started") return "planning";
  if (item.eventType === "execution.started" || item.eventType === "execution.completed") {
    return "execution";
  }
  return "outcome";
}

function isStep(item: TimelineItem): boolean {
  return (
    item.kind === "activity" && item.eventType !== undefined && !HIDDEN_EVENTS.has(item.eventType)
  );
}

/**
 * Events carry no execution or turn identifier, so a step joins its evidence by counting
 * executions in order: the Nth `execution.started` of a run belongs to execution N - 1.
 * Planning turns keep a null `executionSequence`, so they consume trace turns in order too.
 */
export function agentSteps(
  timeline: TimelineItem[],
  executions: AgentExecutionSnapshot[],
  traces: AgentTrace[] = [],
): AgentStep[] {
  // Turns from every loaded run, so a step matches its own run rather than the newest one.
  const turns = traces.flatMap((trace) => (trace.status === "recorded" ? trace.turns : []));
  const executionsByRun = new Map<string, number>();
  const planningByRun = new Map<string, number>();
  return timeline.filter(isStep).map((item, index) => {
    const runId = item.runId ?? null;
    const kind = stepKind(item);
    const key = runId ?? "";
    const execution = executionForStep(item, executionsByRun, executions, key);
    const turn = turnForStep({
      kind,
      planningCounters: planningByRun,
      turns,
      key,
      executionSequence: execution?.sequence,
    });
    return {
      id: item.id,
      runId,
      ordinal: index + 1,
      kind,
      title: item.text,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      ...(execution === undefined ? {} : { execution }),
      ...(turn === undefined ? {} : { turn }),
    };
  });
}

function executionForStep(
  item: TimelineItem,
  counters: Map<string, number>,
  executions: AgentExecutionSnapshot[],
  key: string,
): AgentExecutionSnapshot | undefined {
  if (item.eventType !== "execution.started" && item.eventType !== "execution.completed") {
    return undefined;
  }
  const seen = counters.get(key) ?? 0;
  // `execution.started` opens a sequence and `execution.completed` closes the same one.
  const sequence = item.eventType === "execution.started" ? seen : Math.max(0, seen - 1);
  if (item.eventType === "execution.started") counters.set(key, seen + 1);
  return executions.find((candidate) => candidate.runId === key && candidate.sequence === sequence);
}

interface TurnLookup {
  kind: AgentStep["kind"];
  planningCounters: Map<string, number>;
  turns: AgentInferenceTurn[];
  key: string;
  executionSequence: number | undefined;
}

function turnForStep(lookup: TurnLookup): AgentInferenceTurn | undefined {
  const { kind, planningCounters, turns, key, executionSequence } = lookup;
  const runTurns = turns.filter((turn) => turn.runId === key);
  if (kind === "planning") {
    const seen = planningCounters.get(key) ?? 0;
    planningCounters.set(key, seen + 1);
    return runTurns[seen];
  }
  if (executionSequence === undefined) return undefined;
  return runTurns.find((turn) => turn.executionSequence === executionSequence);
}

export function selectedStep(steps: AgentStep[], selectedStepId: string | undefined) {
  return steps.find((step) => step.id === selectedStepId);
}

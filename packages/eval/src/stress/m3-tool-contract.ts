import type { AgentTrace } from "@vault/shared";
import type { PreparedStressCase } from "./document-workloads.js";

function callName(call: unknown): string | undefined {
  if (typeof call !== "object" || call === null) return undefined;
  const name = (call as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function calledToolNames(trace: AgentTrace | undefined): Set<string> {
  if (trace?.captureVersion !== 1) return new Set();
  const names = trace.turns.flatMap((turn) => {
    const response = turn.structuredResponse;
    if (typeof response !== "object" || response === null) return [];
    const calls = (response as { toolCalls?: unknown }).toolCalls;
    return Array.isArray(calls) ? calls.map(callName) : [];
  });
  return new Set(names.filter((name): name is string => name !== undefined));
}

export function toolContractEvidence(
  fixture: PreparedStressCase,
  executions: number,
  trace: AgentTrace | undefined,
) {
  const requiredExecutionCount = fixture.requiredExecutionCount ?? null;
  const forbiddenTools = fixture.forbiddenTools ?? [];
  const called = calledToolNames(trace);
  return {
    requiredExecutionCount,
    executionCountValid: requiredExecutionCount === null || executions === requiredExecutionCount,
    forbiddenTools,
    calledForbiddenTools: forbiddenTools.filter((name) => called.has(name)),
  };
}

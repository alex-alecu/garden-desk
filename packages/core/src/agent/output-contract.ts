export function requiredOutputLabels(task: string): string[] {
  return [
    ...new Set(
      Array.from(
        task.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)=<[^>\r\n]+>/gu),
        (match) => match[1],
      ).filter((label): label is string => label !== undefined),
    ),
  ];
}

export function missingOutputLabels(stdout: string, requiredLabels: string[]): string[] {
  const lines = new Set(stdout.split(/\r?\n/u).map((line) => line.trim()));
  return requiredLabels.filter(
    (label) => !Array.from(lines).some((line) => line.startsWith(`${label}=`)),
  );
}

export function xlsxWorkflowPhase(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): XlsxWorkflowPhase {
  const completed = executions.filter(completedSuccessfully);
  if (completed.length === 0) return "inspect";
  if (completed.length === 1) return "calculate";
  const last = completed.at(-1);
  return last !== undefined &&
    hasUsefulResult(last) &&
    missingOutputLabels(last.stdout, requiredLabels).length === 0
    ? "complete"
    : "repair-result";
}

import type { AgentExecutionResult } from "@vault/shared";

export type XlsxWorkflowPhase = "inspect" | "calculate" | "repair-result" | "complete";

export function completedSuccessfully(result: AgentExecutionResult): boolean {
  return result.exitCode === 0 && result.termination === "completed";
}

export function hasUsefulResult(result: AgentExecutionResult): boolean {
  return (
    completedSuccessfully(result) &&
    (result.stdout.trim().length > 0 || result.artifacts.length > 0)
  );
}

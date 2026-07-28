import {
  type AgentExecutionResult,
  parseXlsxProgress,
  stripXlsxProgress,
  xlsxContinuationMessage,
} from "@vault/shared";

export type XlsxWorkflowPhase = "work" | "repair" | "continue" | "complete";

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

function requiredExactOutputLines(task: string): string[] {
  return [
    ...new Set(
      Array.from(
        task.matchAll(/\b(?:print|Print)\s+([A-Z][A-Z0-9_]*=[A-Za-z0-9_.:+-]+)\b/gu),
        (match) => match[1],
      ).filter((line): line is string => line !== undefined),
    ),
  ];
}

export function missingOutputLabels(stdout: string, requiredLabels: string[]): string[] {
  const lines = new Set(stdout.split(/\r?\n/u).map((line) => line.trim()));
  return requiredLabels.filter(
    (label) => !Array.from(lines).some((line) => line.startsWith(`${label}=`)),
  );
}

export function completedSuccessfully(result: AgentExecutionResult): boolean {
  return result.exitCode === 0 && result.termination === "completed";
}

function completedXlsxSuccessfully(result: AgentExecutionResult): boolean {
  return completedSuccessfully(result) && result.stderr.trim().length === 0;
}

export function hasUsefulResult(result: AgentExecutionResult): boolean {
  return (
    completedSuccessfully(result) &&
    (result.stdout.trim().length > 0 || result.artifacts.length > 0)
  );
}

export function xlsxWorkflowPhase(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): XlsxWorkflowPhase {
  const last = executions.at(-1);
  if (last === undefined) return "work";
  if (!completedXlsxSuccessfully(last)) return "repair";
  const progress = parseXlsxProgress(last.stdout);
  if (progress === undefined) return "repair";
  if (!progress.complete) return "continue";
  return missingOutputLabels(stripXlsxProgress(last.stdout), requiredLabels).length === 0
    ? "complete"
    : "repair";
}

export function latestIncompleteXlsxProgress(executions: AgentExecutionResult[]) {
  const latestSuccessful = executions.filter(completedXlsxSuccessfully).at(-1);
  if (latestSuccessful === undefined) return undefined;
  const progress = parseXlsxProgress(latestSuccessful.stdout);
  return progress !== undefined && !progress.complete ? progress : undefined;
}

export function xlsxContinuationResponse(executions: AgentExecutionResult[]): string | undefined {
  const progress = latestIncompleteXlsxProgress(executions);
  return progress === undefined ? undefined : xlsxContinuationMessage(progress);
}

export function executionCompletionSummary(result: AgentExecutionResult): string {
  const progress = completedXlsxSuccessfully(result) ? parseXlsxProgress(result.stdout) : undefined;
  return progress === undefined
    ? `${result.language} finished with exit code ${result.exitCode}.`
    : `Processed ${progress.filesDone} of ${progress.filesTotal} XLSX files.`;
}

export function verifiedXlsxOutput(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): string | undefined {
  const last = executions.filter(completedXlsxSuccessfully).at(-1);
  if (last === undefined || !hasUsefulResult(last)) return undefined;
  const progress = parseXlsxProgress(last.stdout);
  if (progress?.complete !== true) return undefined;
  const stdout = stripXlsxProgress(last.stdout);
  return missingOutputLabels(stdout, requiredLabels).length === 0 && stdout.length <= 64_000
    ? stdout
    : undefined;
}

export function verifiedExactOutput(
  executions: AgentExecutionResult[],
  task: string,
): string | undefined {
  const requiredLines = requiredExactOutputLines(task);
  const last = executions.at(-1);
  if (
    requiredLines.length === 0 ||
    requiredOutputLabels(task).length > 0 ||
    last === undefined ||
    last.stdout.length > 64_000
  ) {
    return undefined;
  }
  const observed = last.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return observed.length === requiredLines.length &&
    requiredLines.every((line) => observed.includes(line))
    ? requiredLines.join("\n")
    : undefined;
}

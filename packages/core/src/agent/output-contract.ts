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

function gfmCells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  const cells: string[] = [];
  let cell = "";
  let backslashes = 0;
  for (const character of trimmed.slice(1, -1)) {
    if (character === "|" && backslashes % 2 === 0) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  cells.push(cell.trim());
  return cells;
}

export function validGfmTable(stdout: string): boolean {
  const lines = stdout
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 3) return false;
  const rows = lines.map(gfmCells);
  const header = rows[0];
  const separator = rows[1];
  if (header === undefined || separator === undefined || header.length === 0) return false;
  return (
    separator.length === header.length &&
    separator.every((cell) => /^:?-{3,}:?$/u.test(cell)) &&
    rows.slice(2).every((row) => row !== undefined && row.length === header.length)
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
  if (progress !== undefined) {
    return `Processed ${progress.filesDone} of ${progress.filesTotal} XLSX files.`;
  }
  if (completedSuccessfully(result)) return "Finished this step.";
  if (result.termination === "timeout") return "This step took too long and stopped.";
  if (result.termination === "cancelled") return "This step was cancelled.";
  return "This step could not be completed.";
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
  if (stdout.startsWith("|") && !validGfmTable(stdout)) return undefined;
  return stdout.length > 0 &&
    missingOutputLabels(stdout, requiredLabels).length === 0 &&
    stdout.length <= 64_000
    ? stdout
    : undefined;
}

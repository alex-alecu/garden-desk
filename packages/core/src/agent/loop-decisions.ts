import {
  type AgentDecision,
  type AgentExecutionResult,
  parseWorkProgress,
  workProgressAdvanced,
} from "@vault/shared";
import { requestedArtifactNames, requestedFactLabels } from "./artifact-declarations.js";
import { requestsDirectTable, requestsOverflowArtifact } from "./output-contract.js";
import {
  embedsSourceProgram,
  hasUnterminatedSourceString,
  isInvalidProgram,
  reachedShellCommandLimit,
  startsInteractiveInterpreter,
  usesGuessedSourceExtensionAllowlist,
} from "./source-program-validation.js";

export type RejectedExecutionReason =
  | "duplicate"
  | "invalid"
  | "progress_markers"
  | "progress_inside_loop"
  | "table_truncation"
  | "unterminated_source_string"
  | "unsupported_document_api"
  | "shell_limit"
  | "shell_source"
  | "source_allowlist";

function sameProgram(
  decision: Extract<AgentDecision, { action: "execute" }>,
  execution: AgentExecutionResult,
): boolean {
  return decision.language === "shell"
    ? execution.command === decision.command
    : execution.source === decision.source;
}

function rendersRequestedFactWithColon(
  decision: Extract<AgentDecision, { action: "execute" }>,
  task: string,
): boolean {
  if (decision.language === "shell" || requestedArtifactNames(task).length === 0) return false;
  const labels = requestedFactLabels(task);
  return (
    labels.some((label) => decision.source.includes(`${label}:`)) ||
    (labels.length > 0 && /\{label\}\s*:\s*\{value\}/u.test(decision.source))
  );
}

function truncatesCompleteTable(
  decision: Extract<AgentDecision, { action: "execute" }>,
  task: string,
): boolean {
  if (decision.language === "shell") return false;
  const requestsCompleteTable =
    /\b(?:all|every|complete)\b/iu.test(task) && /\b(?:table|tabel(?:ul)?)\b/iu.test(task);
  if (!requestsCompleteTable) return false;
  const expandedRows = /\b[A-Za-z_]\w*\.append\(\[[^\]\n]*,\s*[^\]\n]*,\s*\*row\s*\]\)/u.test(
    decision.source,
  );
  const savesResult = /\.save\(\s*["']\/workspace\/[^"'\n]+\.[A-Za-z0-9]{1,16}["']/u.test(
    decision.source,
  );
  return (
    (requestsDirectTable(task) && savesResult) ||
    (requestsOverflowArtifact(task) && expandedRows && !savesResult) ||
    (requestsDirectTable(task) &&
      expandedRows &&
      (/\bData\b/u.test(decision.source) ||
        /["'`]\.join\(\s*columns\s*\)/u.test(decision.source))) ||
    /\[\s*-?\d*\s*:\s*-?\d+\s*\]/u.test(decision.source) ||
    /\.slice\(\s*\d*\s*,\s*\d+\s*\)/u.test(decision.source) ||
    serializesExpandedRowAsScalar(decision.source)
  );
}

function serializesExpandedRowAsScalar(source: string): boolean {
  const expandedCollections = new Set(
    [...source.matchAll(/\b([A-Za-z_]\w*)\.append\(\[[^\]\n]*,\s*[^\]\n]*,\s*\*row\s*\]\)/gu)].map(
      (match) => match[1],
    ),
  );
  if (expandedCollections.size === 0) return false;
  for (const match of source.matchAll(/\bfor\s+([A-Za-z_]\w*)\s+in\s+([A-Za-z_]\w*)\s*:/gu)) {
    const item = match[1];
    const collection = match[2];
    if (item === undefined || collection === undefined || !expandedCollections.has(collection))
      continue;
    const body = source.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + 800);
    const scalarIteration = new RegExp(
      `\\bfor\\s+[A-Za-z_]\\w*\\s+in\\s+${item}\\[2\\](?!\\s*:)`,
      "u",
    );
    if (scalarIteration.test(body)) return true;
  }
  return false;
}

function ignoredPythonLine(line: string): boolean {
  return line.trim().length === 0 || line.trimStart().startsWith("#");
}

function pythonIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function closeCompletedLoops(loopIndents: number[], indent: number): void {
  while (loopIndents.at(-1) !== undefined && indent <= (loopIndents.at(-1) ?? 0)) {
    loopIndents.pop();
  }
}

function printsProgressInsideLoop(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  if (decision.language !== "python") return false;
  const loopIndents: number[] = [];
  for (const line of decision.source.split(/\r?\n/u)) {
    if (ignoredPythonLine(line)) continue;
    const indent = pythonIndent(line);
    closeCompletedLoops(loopIndents, indent);
    if (/^\s*(?:async\s+)?(?:for|while)\b[^:]*:\s*(?:#.*)?$/u.test(line)) {
      loopIndents.push(indent);
      continue;
    }
    if (loopIndents.length > 0 && /print\([^\n]*VAULT_PROGRESS_/u.test(line)) return true;
  }
  return false;
}

function hasMalformedProgressMarkers(
  decision: Extract<AgentDecision, { action: "execute" }>,
  requirePresence: boolean,
): boolean {
  if (decision.language !== "python") return false;
  const source = decision.source;
  const markers = ["VAULT_PROGRESS_DONE", "VAULT_PROGRESS_TOTAL", "VAULT_PROGRESS_COMPLETE"];
  if (markers.every((marker) => !source.includes(marker))) return requirePresence;
  if (markers.some((marker) => !source.includes(marker))) return true;
  if (/print\([^\n)]*['"]VAULT_PROGRESS_(?:DONE|TOTAL|COMPLETE)['"]\)/u.test(source)) return true;
  return source.includes("VAULT_PROGRESS_DONE=1") && /VAULT_PROGRESS_TOTAL=\{[^}]+\}/u.test(source);
}

interface RejectionOptions {
  rejectIncompleteSource: boolean;
  requireProgressMarkers: boolean;
  skillRejection?: RejectedExecutionReason;
  task: string;
}

function documentExecutionRejection(
  decision: Extract<AgentDecision, { action: "execute" }>,
  options: RejectionOptions,
): RejectedExecutionReason | undefined {
  if (options.skillRejection !== undefined) return options.skillRejection;
  if (options.rejectIncompleteSource && printsProgressInsideLoop(decision))
    return "progress_inside_loop";
  if (
    options.rejectIncompleteSource &&
    hasMalformedProgressMarkers(decision, options.requireProgressMarkers)
  )
    return "progress_markers";
  return truncatesCompleteTable(decision, options.task) ? "table_truncation" : undefined;
}

function policyRejectionReason(
  decision: Extract<AgentDecision, { action: "execute" }>,
  options: RejectionOptions,
): RejectedExecutionReason | undefined {
  if (reachedShellCommandLimit(decision)) return "shell_limit";
  if (embedsSourceProgram(decision) || startsInteractiveInterpreter(decision))
    return "shell_source";
  if (options.rejectIncompleteSource && usesGuessedSourceExtensionAllowlist(decision, options.task))
    return "source_allowlist";
  const documentRejection = documentExecutionRejection(decision, options);
  if (documentRejection !== undefined) return documentRejection;
  if (rendersRequestedFactWithColon(decision, options.task)) return "invalid";
  if (isInvalidProgram(decision, options.rejectIncompleteSource)) return "invalid";
  if (hasUnterminatedSourceString(decision)) return "unterminated_source_string";
  return undefined;
}

export function rejectedExecutionReason(
  decision: Extract<AgentDecision, { action: "execute" }>,
  executions: AgentExecutionResult[],
  rejectIncompleteSource = false,
  task = "",
): RejectedExecutionReason | undefined {
  return rejectedExecutionReasonWithContext(decision, executions, {
    rejectIncompleteSource,
    task,
  });
}

export function rejectedExecutionReasonWithContext(
  decision: Extract<AgentDecision, { action: "execute" }>,
  executions: AgentExecutionResult[],
  context: {
    rejectIncompleteSource: boolean;
    skillRejection?: RejectedExecutionReason;
    task: string;
  },
): RejectedExecutionReason | undefined {
  const policyRejection = policyRejectionReason(decision, {
    ...context,
    requireProgressMarkers: context.rejectIncompleteSource && executions.length > 0,
  });
  if (policyRejection !== undefined) return policyRejection;
  const matching = executions.filter((execution) => sameProgram(decision, execution));
  const latest = matching.at(-1);
  if (latest === undefined) return undefined;
  if (
    latest.exitCode !== 0 ||
    latest.termination !== "completed" ||
    latest.stderr.trim().length > 0
  )
    return "duplicate";
  const latestProgress = parseWorkProgress(latest.stdout);
  if (latestProgress === undefined || latestProgress.complete) return "duplicate";
  const previousProgress = matching
    .slice(0, -1)
    .map((execution) => parseWorkProgress(execution.stdout))
    .filter((progress) => progress !== undefined)
    .at(-1);
  return previousProgress !== undefined && !workProgressAdvanced(previousProgress, latestProgress)
    ? "duplicate"
    : undefined;
}

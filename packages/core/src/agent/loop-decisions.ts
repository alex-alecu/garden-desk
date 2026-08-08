import {
  type AgentDecision,
  type AgentExecutionResult,
  parseWorkProgress,
  workProgressAdvanced,
} from "@vault/shared";
import { requestedArtifactNames, requestedFactLabels } from "./artifact-declarations.js";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";
import { hasUnbalancedSourceDelimiters } from "./source-delimiters.js";

export type RejectedExecutionReason =
  | "duplicate"
  | "invalid"
  | "unterminated_source_string"
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

function isPathologicallyRepetitive(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  if (decision.language === "shell") return false;
  const lines = decision.source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const repeatedChunk = /([A-Za-z_][A-Za-z0-9_]*\s*=\s*[^;\n]{0,30})\1{7}/u.test(decision.source);
  return (lines.length >= 40 && new Set(lines).size * 3 < lines.length) || repeatedChunk;
}

function isImportOnlySource(decision: Extract<AgentDecision, { action: "execute" }>): boolean {
  if (decision.language === "shell") return false;
  const statements = decision.source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("//") &&
        !line.startsWith("/*") &&
        line !== "*/",
    );
  return (
    statements.length > 0 &&
    statements.every(
      (line) =>
        /^(?:from\s+\S+\s+import\b|import\s+)/u.test(line) ||
        /^(?:const|let|var)\s+\S+\s*=\s*require\(/u.test(line),
    )
  );
}

function containsProtocolFragment(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  return (
    decision.language !== "shell" &&
    /<\|?(?:tool_call|channel|thought)(?:\||>)/iu.test(decision.source)
  );
}

function containsMalformedCallSuffix(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  return decision.language !== "shell" && /\)\p{L}[\p{L}\p{N}_]*\s*(?:$|\n)/u.test(decision.source);
}

function containsBareIdentifierStatement(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  if (decision.language === "shell") return false;
  const allowed = new Set(["break", "continue", "False", "None", "pass", "return", "True"]);
  return decision.source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => /^\p{L}[\p{L}\p{N}_]*$/u.test(line) && !allowed.has(line));
}

function reachedShellCommandLimit(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  return decision.language === "shell" && decision.command.length >= SHELL_COMMAND_CHARACTER_LIMIT;
}

function embedsSourceProgram(decision: Extract<AgentDecision, { action: "execute" }>): boolean {
  return (
    decision.language === "shell" &&
    /(?:^|[;&|]\s*|\n)\s*(?:env\s+)?(?:\S*\/)?(?:python(?:\d+(?:\.\d+)*)?|node)(?:(?:\s+-\S+)*\s+-(?:c|e)(?:\s|$)|(?:\s+-\S+)*\s+(?:-\s*)?<<)/iu.test(
      decision.command,
    )
  );
}

function startsInteractiveInterpreter(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  if (decision.language !== "shell") return false;
  const command = decision.command.trim();
  if (/(?:^|\s)(?:--help|--version|-h|-V)(?:\s|$)/u.test(command)) return false;
  return /^(?:env\s+)?(?:\S*\/)?(?:python(?:\d+(?:\.\d+)*)?|node)(?:\s+-\S*)*$/iu.test(command);
}

function usesGuessedSourceExtensionAllowlist(
  decision: Extract<AgentDecision, { action: "execute" }>,
  task: string,
): boolean {
  return (
    decision.language !== "shell" &&
    /\b(?:codebase|source\s+(?:code|file)|locat(?:e|ing)|search(?:ing)?)\b/iu.test(task) &&
    /\b(?:file|filename|name)\s*\.endswith\s*\(\s*\(/u.test(decision.source)
  );
}

function isInvalidProgram(
  decision: Extract<AgentDecision, { action: "execute" }>,
  rejectIncompleteSource: boolean,
): boolean {
  return (
    containsProtocolFragment(decision) ||
    containsMalformedCallSuffix(decision) ||
    containsBareIdentifierStatement(decision) ||
    isPathologicallyRepetitive(decision) ||
    (rejectIncompleteSource && isImportOnlySource(decision))
  );
}

function hasUnterminatedSourceString(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  return decision.language !== "shell" && hasUnbalancedSourceDelimiters(decision.source);
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

function policyRejectionReason(
  decision: Extract<AgentDecision, { action: "execute" }>,
  rejectIncompleteSource: boolean,
  task: string,
): RejectedExecutionReason | undefined {
  if (reachedShellCommandLimit(decision)) return "shell_limit";
  if (embedsSourceProgram(decision) || startsInteractiveInterpreter(decision))
    return "shell_source";
  if (rejectIncompleteSource && usesGuessedSourceExtensionAllowlist(decision, task))
    return "source_allowlist";
  if (rendersRequestedFactWithColon(decision, task)) return "invalid";
  if (isInvalidProgram(decision, rejectIncompleteSource)) return "invalid";
  if (hasUnterminatedSourceString(decision)) return "unterminated_source_string";
  return undefined;
}

export function rejectedExecutionReason(
  decision: Extract<AgentDecision, { action: "execute" }>,
  executions: AgentExecutionResult[],
  rejectIncompleteSource = false,
  task = "",
): RejectedExecutionReason | undefined {
  const policyRejection = policyRejectionReason(decision, rejectIncompleteSource, task);
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

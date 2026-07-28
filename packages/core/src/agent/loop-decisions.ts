import {
  type AgentDecision,
  type AgentExecutionResult,
  parseXlsxProgress,
  xlsxProgressAdvanced,
} from "@vault/shared";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";

export type RejectedExecutionReason = "duplicate" | "invalid" | "shell_limit" | "shell_source";

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
  return lines.length >= 40 && new Set(lines).size * 3 < lines.length;
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

function reachedShellCommandLimit(
  decision: Extract<AgentDecision, { action: "execute" }>,
): boolean {
  return decision.language === "shell" && decision.command.length >= SHELL_COMMAND_CHARACTER_LIMIT;
}

function embedsSourceProgram(decision: Extract<AgentDecision, { action: "execute" }>): boolean {
  return (
    decision.language === "shell" &&
    /(?:^|[;&|]\s*|\n)\s*(?:env\s+)?(?:\S*\/)?(?:python3?|node)(?:(?:\s+-\S+)*\s+-(?:c|e)(?:\s|$)|(?:\s+-\S+)*\s+(?:-\s*)?<<)/iu.test(
      decision.command,
    )
  );
}

function isInvalidProgram(
  decision: Extract<AgentDecision, { action: "execute" }>,
  rejectIncompleteSource: boolean,
): boolean {
  return (
    containsProtocolFragment(decision) ||
    isPathologicallyRepetitive(decision) ||
    (rejectIncompleteSource && isImportOnlySource(decision))
  );
}

export function rejectedExecutionReason(
  decision: Extract<AgentDecision, { action: "execute" }>,
  executions: AgentExecutionResult[],
  rejectIncompleteSource = false,
): RejectedExecutionReason | undefined {
  if (reachedShellCommandLimit(decision)) return "shell_limit";
  if (embedsSourceProgram(decision)) return "shell_source";
  if (isInvalidProgram(decision, rejectIncompleteSource)) return "invalid";
  const matching = executions.filter((execution) => sameProgram(decision, execution));
  const latest = matching.at(-1);
  if (latest === undefined) return undefined;
  if (
    latest.exitCode !== 0 ||
    latest.termination !== "completed" ||
    latest.stderr.trim().length > 0
  )
    return "duplicate";
  const latestProgress = parseXlsxProgress(latest.stdout);
  if (latestProgress === undefined || latestProgress.complete) return "duplicate";
  const previousProgress = matching
    .slice(0, -1)
    .map((execution) => parseXlsxProgress(execution.stdout))
    .filter((progress) => progress !== undefined)
    .at(-1);
  return previousProgress !== undefined && !xlsxProgressAdvanced(previousProgress, latestProgress)
    ? "duplicate"
    : undefined;
}

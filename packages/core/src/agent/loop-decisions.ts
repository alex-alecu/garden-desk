import {
  type AgentDecision,
  type AgentExecutionResult,
  parseWorkProgress,
  workProgressAdvanced,
} from "@vault/shared";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";

export type RejectedExecutionReason =
  | "duplicate"
  | "invalid"
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
    isPathologicallyRepetitive(decision) ||
    (rejectIncompleteSource && isImportOnlySource(decision))
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
  if (isInvalidProgram(decision, rejectIncompleteSource)) return "invalid";
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

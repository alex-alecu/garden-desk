import type { AgentDecision } from "@vault/shared";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";
import { hasUnbalancedSourceDelimiters } from "./source-delimiters.js";

const MAX_COMPLETE_SOURCE_LINE_CHARACTERS = 500;
type ExecutionDecision = Extract<AgentDecision, { action: "execute" }>;

function isPathologicallyRepetitive(decision: ExecutionDecision): boolean {
  if (decision.language === "shell") return false;
  const sourceLines = decision.source.split(/\r?\n/u);
  const lines = sourceLines.map((line) => line.trim()).filter((line) => line.length > 0);
  const repeatedChunk = /([A-Za-z_][A-Za-z0-9_]*\s*=\s*[^;\n]{0,30})\1{7}/u.test(decision.source);
  return (
    sourceLines.some((line) => line.length >= MAX_COMPLETE_SOURCE_LINE_CHARACTERS) ||
    (lines.length >= 40 && new Set(lines).size * 3 < lines.length) ||
    repeatedChunk
  );
}

function isImportOnlySource(decision: ExecutionDecision): boolean {
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

function definesUncalledEntryPoint(decision: ExecutionDecision): boolean {
  if (decision.language === "shell") return false;
  const lines = decision.source.split(/\r?\n/u);
  const definition =
    decision.language === "python"
      ? /^\s*(?:async\s+)?def\s+main\s*\(/u
      : /^\s*(?:async\s+)?function\s+main\s*\(/u;
  if (!lines.some((line) => definition.test(line))) return false;
  return !lines.some(
    (line) => !definition.test(line) && !/^\s*(?:#|\/\/)/u.test(line) && /\bmain\s*\(/u.test(line),
  );
}

function pythonIndent(line: string): number {
  return line.length - line.trimStart().length;
}

function pythonFunctionBody(lines: string[], definitionIndex: number): string[] {
  const definition = /^(\s*)(?:async\s+)?def\s+\w+\s*\(/u.exec(lines[definitionIndex] ?? "");
  if (definition === null) return [];
  const definitionIndent = definition[1]?.length ?? 0;
  const body: string[] = [];
  for (const line of lines.slice(definitionIndex + 1)) {
    if (
      line.trim().length > 0 &&
      !line.trimStart().startsWith("#") &&
      pythonIndent(line) <= definitionIndent
    )
      break;
    body.push(line);
  }
  return body;
}

function matchingNames(lines: readonly string[], pattern: RegExp): Set<string> {
  return new Set(
    lines.flatMap((line) => pattern.exec(line)?.[1]?.split(",") ?? []).map((name) => name.trim()),
  );
}

function functionMutatesUnboundLocal(lines: readonly string[]): boolean {
  const locals = matchingNames(lines, /^\s*([A-Za-z_]\w*)\s*=(?!=)/u);
  const declared = matchingNames(lines, /^\s*(?:global|nonlocal)\s+(.+)$/u);
  const mutation = /^\s*([A-Za-z_]\w*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*|&|\||\^|<<|>>)=/u;
  return lines.some((line) => {
    const name = mutation.exec(line)?.[1];
    return name !== undefined && !locals.has(name) && !declared.has(name);
  });
}

function mutatesUnboundPythonLocal(decision: ExecutionDecision): boolean {
  if (decision.language !== "python") return false;
  const lines = decision.source.split(/\r?\n/u);
  return lines.some((_line, index) =>
    functionMutatesUnboundLocal(pythonFunctionBody(lines, index)),
  );
}

export function reachedShellCommandLimit(decision: ExecutionDecision): boolean {
  return decision.language === "shell" && decision.command.length >= SHELL_COMMAND_CHARACTER_LIMIT;
}

export function embedsSourceProgram(decision: ExecutionDecision): boolean {
  return (
    decision.language === "shell" &&
    /(?:^|[;&|]\s*|\n)\s*(?:env\s+)?(?:\S*\/)?(?:python(?:\d+(?:\.\d+)*)?|node)(?:(?:\s+-\S+)*\s+-(?:c|e)(?:\s|$)|(?:\s+-\S+)*\s+(?:-\s*)?<<)/iu.test(
      decision.command,
    )
  );
}

export function startsInteractiveInterpreter(decision: ExecutionDecision): boolean {
  if (decision.language !== "shell") return false;
  const command = decision.command.trim();
  if (/(?:^|\s)(?:--help|--version|-h|-V)(?:\s|$)/u.test(command)) return false;
  return /^(?:env\s+)?(?:\S*\/)?(?:python(?:\d+(?:\.\d+)*)?|node)(?:\s+-\S*)*$/iu.test(command);
}

export function usesGuessedSourceExtensionAllowlist(
  decision: ExecutionDecision,
  task: string,
): boolean {
  return (
    decision.language !== "shell" &&
    /\b(?:codebase|source\s+(?:code|file)|locat(?:e|ing)|search(?:ing)?)\b/iu.test(task) &&
    /\b(?:file|filename|name)\s*\.endswith\s*\(\s*\(/u.test(decision.source)
  );
}

export function isInvalidProgram(
  decision: ExecutionDecision,
  rejectIncompleteSource: boolean,
): boolean {
  if (decision.language === "shell") return false;
  const allowed = new Set(["break", "continue", "False", "None", "pass", "return", "True"]);
  const bareIdentifier = decision.source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => /^\p{L}[\p{L}\p{N}_]*$/u.test(line) && !allowed.has(line));
  return (
    /<\|?(?:tool_call|channel|thought)(?:\||>)/iu.test(decision.source) ||
    /\)\p{L}[\p{L}\p{N}_]*\s*(?:$|\n)/u.test(decision.source) ||
    definesUncalledEntryPoint(decision) ||
    bareIdentifier ||
    mutatesUnboundPythonLocal(decision) ||
    isPathologicallyRepetitive(decision) ||
    (rejectIncompleteSource && isImportOnlySource(decision))
  );
}

export function hasUnterminatedSourceString(decision: ExecutionDecision): boolean {
  return decision.language !== "shell" && hasUnbalancedSourceDelimiters(decision.source);
}

import type { AgentExecutionSnapshot, AgentTrace, ChatToolCall } from "@vault/shared";
import { approvedAntiwordLocale } from "./legacy-doc-locale.js";
import {
  approvedDocumentPath,
  hasApprovedGlobDiscovery,
  hasApprovedIterdirDiscovery,
} from "./legacy-doc-path.js";

const WORD_DOCUMENTS = "word-documents";

type PythonStatement =
  | { body: string; condition: string; indent: number; kind: "if" }
  | { indent: number; kind: "assignment"; name: string; value: string }
  | { indent: number; kind: "terminal" | "other" };

export type LegacyDocEvidence = { methodValid: boolean; orderValid: boolean };

function calls(response: unknown): ChatToolCall[] {
  if (typeof response !== "object" || response === null) return [];
  const toolCalls = (response as { toolCalls?: unknown }).toolCalls;
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.filter(
    (call): call is ChatToolCall =>
      typeof call === "object" &&
      call !== null &&
      typeof (call as { name?: unknown }).name === "string",
  );
}

function textParam(call: ChatToolCall, name: string): string | undefined {
  if (typeof call.params !== "object" || call.params === null) return undefined;
  const value = (call.params as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function accessText(call: ChatToolCall): string | undefined {
  if (call.name === "bash") return textParam(call, "command");
  if (call.name === "python" || call.name === "node") return textParam(call, "source");
  return textParam(call, "path");
}

function accessesLegacyDoc(call: ChatToolCall): boolean {
  const text = accessText(call);
  return text !== undefined && /\/(?:source|run\/attachments)[\s\S]*\.doc\b/iu.test(text);
}

function orderedCalls(trace: AgentTrace | undefined): ChatToolCall[] {
  if (trace?.captureVersion !== 1) return [];
  return [...trace.turns]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((turn) => turn.outcome === "accepted_tool_calls")
    .flatMap((turn) => calls(turn.structuredResponse));
}

function statementAt(indent: number, source: string): PythonStatement {
  const ifMatch = /^if\s+([\s\S]+?)\s*:\s*(.*)$/u.exec(source);
  if (ifMatch !== null)
    return { kind: "if", indent, condition: ifMatch[1] ?? "", body: ifMatch[2] ?? "" };
  const assignment = /^([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/u.exec(source);
  if (assignment !== null)
    return { kind: "assignment", indent, name: assignment[1] ?? "", value: assignment[2] ?? "" };
  return {
    kind: /^(?:raise\b|(?:sys\.)?exit\s*\()/u.test(source) ? "terminal" : "other",
    indent,
  };
}

function pythonStatements(source: string): PythonStatement[] {
  const statements: PythonStatement[] = [];
  let pending: { indent: number; source: string } | undefined;
  let depth = 0;
  for (const rawLine of source.replaceAll(/("""|''')[\s\S]*?\1/gu, "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (pending === undefined) pending = { indent, source: line };
    else pending.source += ` ${line}`;
    depth += [...line].reduce((total, character) => total + groupingChange(character), 0);
    if (depth === 0) {
      statements.push(statementAt(pending.indent, pending.source));
      pending = undefined;
    }
  }
  return statements;
}

function groupingChange(character: string): number {
  if (character === "(" || character === "[" || character === "{") return 1;
  if (character === ")" || character === "]" || character === "}") return -1;
  return 0;
}

function splitArguments(source: string): string[] {
  const arguments_: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    depth += groupingChange(source[index] ?? "");
    if (source[index] === "," && depth === 0) {
      arguments_.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  arguments_.push(source.slice(start).trim());
  return arguments_;
}

const compact = (source: string): string => source.replaceAll(/\s/gu, "");

function valuesFor(arguments_: string[], name: string): string[] {
  const expression = new RegExp(`^${name}\\s*=\\s*([\\s\\S]+)$`, "u");
  return arguments_.flatMap((argument) => expression.exec(argument)?.[1] ?? []);
}

function stringValue(source: string): string | undefined {
  const match = /^(["'])([\s\S]*)\1$/u.exec(source.trim());
  return match?.[2];
}

function antiwordInput(value: string): string | undefined {
  const list = value.trim();
  if (!list.startsWith("[") || !list.endsWith("]")) return undefined;
  const arguments_ = splitArguments(list.slice(1, -1));
  const expected = ["/usr/bin/antiword", "-m", "UTF-8.txt", "-w", "0"];
  if (
    arguments_.length !== 6 ||
    !expected.every((option, index) => stringValue(arguments_[index] ?? "") === option)
  ) {
    return undefined;
  }
  return /^str\s*\(\s*([A-Za-z_]\w*)\s*\)$/u.exec(arguments_[5] ?? "")?.[1];
}

function directDocumentSelection(value: string): boolean {
  if (approvedDocumentPath(value)) return true;
  return (
    (hasApprovedGlobDiscovery(value) || hasApprovedIterdirDiscovery(value)) &&
    (/^next\s*\(/u.test(value.trim()) || /\[\s*\d+\s*\]$/u.test(value.trim()))
  );
}

function documentReference(value: string): { indexed: boolean; name: string } | undefined {
  const match = /^([A-Za-z_]\w*)(\s*\[\s*\d+\s*\])?$/u.exec(value.trim());
  if (match === null) return undefined;
  return { name: match[1] ?? "", indexed: match[2] !== undefined };
}

function approvedDocumentAssignment(
  statements: PythonStatement[],
  index: number,
  seen = new Set<number>(),
): boolean {
  const statement = statements[index];
  if (statement?.kind !== "assignment" || statement.indent !== 0 || seen.has(index)) return false;
  if (directDocumentSelection(statement.value)) return true;
  const reference = documentReference(statement.value);
  if (reference === undefined) return false;
  seen.add(index);
  for (let prior = index - 1; prior >= 0; prior -= 1) {
    const candidate = statements[prior];
    if (candidate?.kind !== "assignment" || candidate.name !== reference.name) continue;
    return (
      (reference.indexed && hasApprovedGlobDiscovery(candidate.value)) ||
      approvedDocumentAssignment(statements, prior, seen)
    );
  }
  return false;
}

type ApprovedRun = { failure: "check" | "guard"; input: string };

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This AST node validates one fixed call contract.
function approvedRun(statement: PythonStatement): ApprovedRun | undefined {
  if (statement.kind !== "assignment" || statement.indent !== 0 || statement.name !== "result") {
    return undefined;
  }
  const match = /^subprocess\.run\s*\(([\s\S]*)\)$/u.exec(statement.value);
  if (match === null) return undefined;
  const arguments_ = splitArguments(match[1] ?? "");
  const input = antiwordInput(arguments_[0] ?? "");
  const checks = valuesFor(arguments_, "check");
  const captured = valuesFor(arguments_, "capture_output");
  const environments = valuesFor(arguments_, "env");
  const timeouts = valuesFor(arguments_, "timeout");
  if (
    input === undefined ||
    captured.length !== 1 ||
    compact(captured[0] ?? "") !== "True" ||
    environments.length !== 1 ||
    !approvedAntiwordLocale(environments[0] ?? "") ||
    timeouts.length !== 1 ||
    compact(timeouts[0] ?? "") !== "5" ||
    valuesFor(arguments_, "shell").some((value) => compact(value) !== "False") ||
    checks.length > 1
  ) {
    return undefined;
  }
  if (checks.length === 1 && compact(checks[0] ?? "") === "True")
    return { input, failure: "check" };
  if (checks.length === 0 || compact(checks[0] ?? "") === "False")
    return { input, failure: "guard" };
  return undefined;
}

function decodedText(statement: PythonStatement): string | undefined {
  if (statement.kind !== "assignment" || statement.indent !== 0) return undefined;
  const match =
    /^result\.stdout\.decode\s*\(\s*["']utf-8["']\s*,\s*errors\s*=\s*["']strict["']\s*\)$/u.exec(
      statement.value,
    );
  return match === null ? undefined : statement.name;
}

function guardAfter(
  statements: PythonStatement[],
  start: number,
  condition: (source: string) => boolean,
): boolean {
  return statements.slice(start + 1).some((statement, index, remaining) => {
    if (statement.kind !== "if" || statement.indent !== 0 || !condition(statement.condition)) {
      return false;
    }
    const next = remaining[index + 1];
    return (
      /^(?:raise\b|(?:sys\.)?exit\s*\()/u.test(statement.body) ||
      (next?.kind === "terminal" && next.indent > statement.indent)
    );
  });
}

function hasReturnCodeGuard(statements: PythonStatement[], start: number, before: number): boolean {
  return guardAfter(statements.slice(0, before), start, (condition) =>
    ["result.returncode", "result.returncode!=0"].includes(condition.replaceAll(/[\s()]/gu, "")),
  );
}

function hasNonblankGuard(statements: PythonStatement[], start: number, text: string): boolean {
  return guardAfter(statements, start, (condition) => {
    const value = compact(condition);
    return (
      value === `not${text}.strip()` ||
      value === `${text}.strip()==""` ||
      value === `${text}.strip()==''`
    );
  });
}

function approvedExtraction(execution: AgentExecutionSnapshot): boolean {
  if (
    execution.language !== "python" ||
    execution.state !== "completed" ||
    execution.exitCode !== 0 ||
    execution.source === null
  )
    return false;
  const statements = pythonStatements(execution.source);
  return statements.some((source, sourceIndex) => {
    if (source.kind !== "assignment" || !approvedDocumentAssignment(statements, sourceIndex))
      return false;
    return statements.some(
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This callback links ordered required evidence.
      (statement, runIndex) => {
        const run = runIndex > sourceIndex ? approvedRun(statement) : undefined;
        const decodeIndex = statements.findIndex(
          (candidate, index) => index > runIndex && decodedText(candidate) !== undefined,
        );
        if (
          run?.input !== source.name ||
          (run.failure === "guard" && !hasReturnCodeGuard(statements, runIndex, decodeIndex))
        )
          return false;
        const text =
          decodeIndex < 0
            ? undefined
            : decodedText(statements[decodeIndex] ?? { kind: "other", indent: 0 });
        return text !== undefined && hasNonblankGuard(statements, decodeIndex, text);
      },
    );
  });
}

export function legacyDocEvidence(
  fixtureId: string,
  snapshot: { executions: AgentExecutionSnapshot[] },
  trace: AgentTrace | undefined,
): LegacyDocEvidence {
  if (fixtureId !== "legacy-doc-read") return { methodValid: true, orderValid: true };
  const actions = orderedCalls(trace);
  const skillLoad = actions.findIndex(
    (call) => call.name === "skill" && textParam(call, "name") === WORD_DOCUMENTS,
  );
  const documentAccess = actions.findIndex(accessesLegacyDoc);
  return {
    methodValid: snapshot.executions.some(approvedExtraction),
    orderValid: skillLoad >= 0 && documentAccess >= 0 && skillLoad < documentAccess,
  };
}

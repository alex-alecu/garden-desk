import { type AgentDecision, AgentDecisionSchema, AgentWorkspacePathSchema } from "@vault/shared";

const SOURCE_STATEMENT_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "False",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "None",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "True",
  "try",
  "while",
  "with",
  "yield",
]);

// A trailing line made only of bare identifier tokens is hallucinated debris,
// not code: real closing statements carry punctuation such as `()` or a leading
// keyword. Gemma occasionally appends schema-field names (for example
// `skills_requested_none`) after `main()`, which would otherwise turn an already
// correct repair into an invalid program and stall the run.
function isTrailingIdentifierDebris(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !/^[\p{L}\p{N}_]+(?: [\p{L}\p{N}_]+)*$/u.test(trimmed)) return false;
  const [first] = trimmed.split(" ");
  return first !== undefined && !SOURCE_STATEMENT_KEYWORDS.has(first);
}

function withoutTrailingIdentifierDebris(lines: unknown[]): unknown[] {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (typeof line !== "string" || !isTrailingIdentifierDebris(line)) break;
    end -= 1;
  }
  return end === lines.length ? lines : lines.slice(0, end);
}

export function normalizeSourceItems(items: unknown[]): unknown[] {
  const lines = items
    .flatMap((line) => {
      if (typeof line !== "string") return [line];
      // An item that already spans lines is a complete block, so its remaining
      // `\n` escapes belong inside string literals. Expanding them would break
      // those strings across lines and make valid source unparseable.
      if (/\r?\n/u.test(line)) return line.split(/\r?\n/u);
      const escapedSeparators = line.match(/\\n/gu)?.length ?? 0;
      const blockShaped =
        line === "\\n" || line.startsWith("\\n") || line.endsWith("\\n") || escapedSeparators >= 2;
      return (blockShaped ? line.replaceAll("\\n", "\n") : line).split(/\r?\n/u);
    })
    .filter((line) => typeof line !== "string" || line.trim().length > 0)
    .map((line) =>
      typeof line === "string" ? line.replace(/(\)\s*)\p{L}[\p{L}\p{N}_]*\s*$/u, "$1") : line,
    );
  let squareDepth = 0;
  const balanced = lines.filter((line) => {
    if (typeof line !== "string") return true;
    const opens = line.match(/\[/gu)?.length ?? 0;
    const closes = line.match(/\]/gu)?.length ?? 0;
    if (/^\s*\],?\s*$/u.test(line) && squareDepth === 0) return false;
    squareDepth = Math.max(0, squareDepth + opens - closes);
    return true;
  });
  return withoutTrailingIdentifierDebris(balanced);
}

function normalizedSourcePath(path: unknown): unknown {
  if (path === undefined) return path;
  const parsed = AgentWorkspacePathSchema.safeParse(path);
  const commandShaped =
    typeof path === "string" && /(?:^|\s)\/(?:source|workspace)(?:\/|\s|$)/u.test(path);
  return parsed.success && !commandShaped ? path : undefined;
}

export function parseAgentDecision(value: unknown): AgentDecision {
  if (typeof value !== "object" || value === null) return AgentDecisionSchema.parse(value);
  const decision = value as Record<string, unknown>;
  if (decision.action === "execute" && Array.isArray(decision.source)) {
    return AgentDecisionSchema.parse({
      ...decision,
      source: normalizeSourceItems(decision.source).join("\n"),
      path: normalizedSourcePath(decision.path),
    });
  }
  if (decision.action === "execute" && Array.isArray(decision.command)) {
    return AgentDecisionSchema.parse({ ...decision, command: decision.command.join("\n") });
  }
  if (decision.action === "respond" && Array.isArray(decision.response)) {
    return AgentDecisionSchema.parse({ ...decision, response: decision.response.join("\n") });
  }
  return AgentDecisionSchema.parse(value);
}

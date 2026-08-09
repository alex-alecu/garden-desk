import { type AgentDecision, AgentDecisionSchema, AgentWorkspacePathSchema } from "@vault/shared";

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
  return lines.filter((line) => {
    if (typeof line !== "string") return true;
    const opens = line.match(/\[/gu)?.length ?? 0;
    const closes = line.match(/\]/gu)?.length ?? 0;
    if (/^\s*\],?\s*$/u.test(line) && squareDepth === 0) return false;
    squareDepth = Math.max(0, squareDepth + opens - closes);
    return true;
  });
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

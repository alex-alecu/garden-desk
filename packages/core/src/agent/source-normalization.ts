import type { AgentDecision } from "@vault/shared";
import type { SkillSourceRemoval } from "./prompt-skill-metadata.js";

function occurrences(source: string, identifier: string): number {
  return source.match(new RegExp(`\\b${identifier}\\b`, "gu"))?.length ?? 0;
}

export function removeUnusedSourceLines(
  decision: AgentDecision,
  rules: readonly SkillSourceRemoval[],
): AgentDecision {
  if (decision.action !== "execute" || decision.language === "shell") return decision;
  const removable = new Set(
    rules
      .filter(
        ({ line, identifier }) =>
          decision.source.includes(line) && occurrences(decision.source, identifier) === 1,
      )
      .map(({ line }) => line),
  );
  if (removable.size === 0) return decision;
  return {
    ...decision,
    source: decision.source
      .split(/\r?\n/u)
      .filter((line) => !removable.has(line.trim()))
      .join("\n"),
  };
}

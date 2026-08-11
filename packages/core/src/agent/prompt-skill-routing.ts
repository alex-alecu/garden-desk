import type { PromptSkill, SkillSelectionInput } from "./prompt-library.js";

const FORMAT_ACTION =
  "(?:create|generate|write|make|build|produce|save|return|convert|read|review|inspect|check|tell|locate|search|summarize|extract|edit|update|merge|split|rotate|find|total|sum|calculate|analyze|process|validate|raport|raportează|raporteaza|citește|citeste|analizează|analizeaza|calculează|calculeaza|caută|cauta)";
const ROUTING_STOP_WORDS = new Set([
  "agent",
  "and",
  "asks",
  "attachment",
  "attached",
  "explicit",
  "filename",
  "for",
  "from",
  "guides",
  "has",
  "including",
  "local",
  "mention",
  "mentions",
  "read",
  "requires",
  "selected",
  "shell",
  "source",
  "task",
  "the",
  "use",
  "when",
  "with",
]);

function routingTerms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3 && !ROUTING_STOP_WORDS.has(term)),
  );
}

function escapedPattern(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&").replaceAll(/\s+/gu, "\\s+");
}

function taskRequestsKeyword(task: string, keyword: string): boolean {
  const value = escapedPattern(keyword);
  const boundary = "[\\p{L}\\p{N}_]";
  const action = `(?<!${boundary})${FORMAT_ACTION}(?!${boundary})`;
  const term = `(?<!${boundary})${value}(?!${boundary})`;
  return new RegExp(`(?:${action}[^\\n]{0,120}${term}|${term}[^\\n]{0,120}${action})`, "iu").test(
    task,
  );
}

function declarativeSkillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean {
  const names = [...input.inputNames, ...(input.evidenceNames ?? [])];
  const extensionApplies = skill.triggerExtensions.some((extension) =>
    names.some((name) => name.toLocaleLowerCase("en-US").endsWith(extension)),
  );
  const namesExtension = skill.triggerExtensions.some((extension) =>
    new RegExp(`${escapedPattern(extension)}(?![\\p{L}\\p{N}_])`, "iu").test(input.task),
  );
  return (
    extensionApplies ||
    namesExtension ||
    skill.triggerKeywords.some((keyword) => taskRequestsKeyword(input.task, keyword))
  );
}

export function skillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean {
  if (input.suppressedSkillNames?.includes(skill.name) === true) return false;
  if (input.suppressProgressSkills === true && skill.usesProgressMarkers) return false;
  if (input.requestedSkillNames?.includes(skill.name) === true) return true;
  if (declarativeSkillApplies(skill, input)) return true;
  if (skill.triggerExtensions.length > 0 || skill.triggerKeywords.length > 0) return false;
  const names = [...input.inputNames, ...(input.evidenceNames ?? [])];
  const evidenceTerms = routingTerms([input.task, ...names].join("\n"));
  const triggerText = skill.description.split(/\buse when\b/iu).at(-1) ?? skill.description;
  return [...routingTerms(triggerText)].some((term) => evidenceTerms.has(term));
}

export function taskContainsKeyword(task: string, keyword: string): boolean {
  const boundary = "[\\p{L}\\p{N}_]";
  return new RegExp(`(?<!${boundary})${escapedPattern(keyword)}(?!${boundary})`, "iu").test(task);
}

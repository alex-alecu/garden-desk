import { basename, join, resolve } from "node:path";
import {
  promptDirectoryExists,
  promptMarkdownFiles,
  promptSkillDirectories,
  readPromptFile,
} from "../prompt-files.js";
import { parseSkillMetadata, type SkillRepairTrigger } from "./prompt-skill-metadata.js";

const PROMPT_FILE_LIMIT = 128_000;
const PLACEHOLDER = /\{\{([a-z0-9_]+)\}\}/gu;
const FORMAT_ACTION =
  "(?:create|generate|write|make|build|produce|save|convert|read|review|inspect|check|tell|locate|summarize|extract|edit|update|merge|split|rotate|find|total|sum|calculate|analyze|process|validate|raport|raportează|raporteaza|citește|citeste|analizează|analizeaza|calculează|calculeaza)";
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

export interface PromptSkill {
  body: string;
  description: string;
  name: string;
  repairTriggers: readonly SkillRepairTrigger[];
  triggerExtensions: readonly string[];
  triggerKeywords: readonly string[];
  usesProgressMarkers: boolean;
  producesDeliverables: boolean;
  recoveryPrompts: ReadonlyMap<string, string>;
  statePrompts: ReadonlyMap<string, string>;
}

export interface SkillSelectionInput {
  evidenceNames?: readonly string[];
  inputNames: string[];
  requestedSkillNames?: readonly string[];
  suppressedSkillNames?: readonly string[];
  suppressProgressSkills?: boolean;
  task: string;
}

export type PromptValues = Readonly<Record<string, string | number>>;

function readPrompt(path: string): string {
  const content = readPromptFile(path).trim();
  if (content.length === 0 || content.length > PROMPT_FILE_LIMIT) {
    throw new Error(`Invalid prompt file: ${path}`);
  }
  return content;
}

function promptFiles(directory: string): Map<string, string> {
  const prompts = new Map<string, string>();
  if (!promptDirectoryExists(directory)) return prompts;
  for (const entry of promptMarkdownFiles(directory)) {
    prompts.set(basename(entry.name, ".md"), readPrompt(entry.path));
  }
  return prompts;
}

export function parsePromptSkill(directoryName: string, content: string): PromptSkill {
  return {
    ...parseSkillMetadata(directoryName, content),
    recoveryPrompts: new Map(),
    statePrompts: new Map(),
  };
}

function loadSkills(directory: string): PromptSkill[] {
  return promptSkillDirectories(directory)
    .map((entry) => ({
      ...parseSkillMetadata(entry.name, readPrompt(join(entry.path, "SKILL.md"))),
      recoveryPrompts: promptFiles(join(entry.path, "recovery")),
      statePrompts: promptFiles(join(entry.path, "states")),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
}

function routingTerms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3 && !ROUTING_STOP_WORDS.has(term)),
  );
}

function hasExtension(values: readonly string[], extension: string): boolean {
  return values.some((name) => name.toLocaleLowerCase("en-US").endsWith(extension));
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

function taskNamesExtension(task: string, extension: string): boolean {
  return new RegExp(`${escapedPattern(extension)}(?![\\p{L}\\p{N}_])`, "iu").test(task);
}

function declarativeSkillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean {
  const names = [...input.inputNames, ...(input.evidenceNames ?? [])];
  const extensionApplies = skill.triggerExtensions.some(
    (extension) => hasExtension(names, extension) || taskNamesExtension(input.task, extension),
  );
  return (
    extensionApplies ||
    skill.triggerKeywords.some((keyword) => taskRequestsKeyword(input.task, keyword))
  );
}

function skillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean {
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

function render(content: string, values: PromptValues): string {
  return content.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing prompt value: ${name}`);
    return String(value);
  });
}

export class PromptLibrary {
  readonly skills: readonly PromptSkill[];
  private readonly recoveryPrompts: Map<string, string>;
  private readonly statePrompts: Map<string, string>;
  private readonly systemPrompts: Map<string, string>;

  constructor(readonly root: string) {
    this.systemPrompts = promptFiles(join(root, "system"));
    this.statePrompts = promptFiles(join(root, "states"));
    this.recoveryPrompts = promptFiles(join(root, "recovery"));
    this.skills = loadSkills(join(root, "skills"));
  }

  system(name: string, values: PromptValues = {}): string {
    return render(this.required(this.systemPrompts, "system", name), values);
  }

  state(name: string, values: PromptValues = {}): string {
    return render(this.required(this.statePrompts, "state", name), values);
  }

  skillState(skillName: string, name: string, values: PromptValues = {}): string {
    const skill = this.skill(skillName);
    return render(
      skill.statePrompts.get(name) ?? this.required(this.statePrompts, "state", name),
      values,
    );
  }

  recovery(name: string, values: PromptValues = {}): string {
    return render(this.required(this.recoveryPrompts, "recovery", name), values);
  }

  skillRecovery(skillName: string, name: string, values: PromptValues = {}): string {
    const skill = this.skill(skillName);
    return render(
      skill.recoveryPrompts.get(name) ?? this.required(this.recoveryPrompts, "recovery", name),
      values,
    );
  }

  skillCatalog(activeNames: ReadonlySet<string>): string {
    return this.skills
      .map(
        (skill) =>
          `- ${skill.name} (${activeNames.has(skill.name) ? "active" : "available"}): ${skill.description}`,
      )
      .join("\n");
  }

  activeSkills(input: SkillSelectionInput, values: PromptValues): string {
    return this.selectedSkills(input)
      .map((skill) => `## Active skill: ${skill.name}\n\n${render(skill.body, values)}`)
      .join("\n\n");
  }

  activeSkillNames(input: SkillSelectionInput): ReadonlySet<string> {
    return new Set(this.selectedSkills(input).map((skill) => skill.name));
  }

  progressSkill(activeNames: ReadonlySet<string>): PromptSkill | undefined {
    return this.skills.find((skill) => activeNames.has(skill.name) && skill.usesProgressMarkers);
  }

  deliverableSkill(activeNames: ReadonlySet<string>): PromptSkill | undefined {
    return this.skills.find((skill) => activeNames.has(skill.name) && skill.producesDeliverables);
  }

  repairPrompts(activeNames: ReadonlySet<string>, output: string): string[] {
    return this.skills
      .filter((skill) => activeNames.has(skill.name))
      .flatMap((skill) =>
        skill.repairTriggers
          .filter((trigger) => trigger.pattern.test(output))
          .map((trigger) => this.skillRecovery(skill.name, trigger.prompt)),
      );
  }

  hasSkill(name: string): boolean {
    return this.skills.some((skill) => skill.name === name);
  }

  skillNames(): string[] {
    return this.skills.map((skill) => skill.name);
  }

  private selectedSkills(input: SkillSelectionInput): PromptSkill[] {
    return this.skills.filter((skill) => skillApplies(skill, input));
  }

  private skill(name: string): PromptSkill {
    const skill = this.skills.find((candidate) => candidate.name === name);
    if (skill === undefined) throw new Error(`Unknown skill: ${name}`);
    return skill;
  }

  private required(prompts: Map<string, string>, kind: string, name: string): string {
    const content = prompts.get(name);
    if (content === undefined) throw new Error(`Missing ${kind} prompt: ${name}`);
    return content;
  }
}

let defaultLibrary: PromptLibrary | undefined;

export function defaultPromptLibrary(): PromptLibrary {
  defaultLibrary ??= new PromptLibrary(resolve(process.cwd(), "prompts"));
  return defaultLibrary;
}

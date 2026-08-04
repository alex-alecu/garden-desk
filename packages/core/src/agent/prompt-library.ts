import { basename, join, resolve } from "node:path";
import { promptMarkdownFiles, promptSkillDirectories, readPromptFile } from "../prompt-files.js";

const PROMPT_FILE_LIMIT = 128_000;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLACEHOLDER = /\{\{([a-z0-9_]+)\}\}/gu;
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
}

export interface SkillSelectionInput {
  inputNames: string[];
  requiredSkillNames?: readonly string[];
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
  for (const entry of promptMarkdownFiles(directory)) {
    const name = basename(entry.name, ".md");
    prompts.set(name, readPrompt(entry.path));
  }
  return prompts;
}

function frontmatterValue(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const values = lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  if (values.length !== 1 || values[0]?.length === 0) return undefined;
  const value = values[0] as string;
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

export function parsePromptSkill(directoryName: string, content: string): PromptSkill {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(content.trim());
  if (match === null) throw new Error(`Skill ${directoryName} has invalid frontmatter.`);
  const frontmatter = match[1]?.split(/\r?\n/u) ?? [];
  const name = frontmatterValue(frontmatter, "name");
  const description = frontmatterValue(frontmatter, "description");
  const body = match[2]?.trim() ?? "";
  if (
    name === undefined ||
    description === undefined ||
    name !== directoryName ||
    !SKILL_NAME.test(name) ||
    name.length > 64 ||
    description.length > 1_024 ||
    !/\buse when\b/iu.test(description) ||
    body.length === 0
  ) {
    throw new Error(`Skill ${directoryName} does not satisfy the Agent Skills contract.`);
  }
  return { body, description, name };
}

function loadSkills(directory: string): PromptSkill[] {
  return promptSkillDirectories(directory)
    .map((entry) => {
      const content = readPrompt(join(directory, entry.name, "SKILL.md"));
      return parsePromptSkill(entry.name, content);
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
}

function routingTerms(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("en-US")
      .split(/[^a-z0-9]+/u)
      .filter((term) => term.length >= 3 && !ROUTING_STOP_WORDS.has(term)),
  );
}

function hasInputExtension(input: SkillSelectionInput, extension: string): boolean {
  return input.inputNames.some((name) => name.toLocaleLowerCase("en-US").endsWith(extension));
}

const FORMAT_ACTION =
  "(?:create|generate|write|make|build|produce|save|convert|read|review|inspect|summarize|extract|edit|update|merge|split|rotate|find|total|sum|calculate|analyze|process|validate)";

function taskRequestsFormat(task: string, format: string): boolean {
  return new RegExp(
    `(?:\\b${FORMAT_ACTION}\\b[^\\n]{0,100}\\b(?:${format})\\b|\\b(?:${format})\\b[^\\n]{0,100}\\b${FORMAT_ACTION}\\b)`,
    "iu",
  ).test(task);
}

function formatSkillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean | undefined {
  const task = input.task;
  if (skill.name === "docx-documents") {
    return (
      hasInputExtension(input, ".docx") ||
      /\.docx\b/iu.test(task) ||
      taskRequestsFormat(task, "docx|(?:microsoft\\s+)?word\\s+(?:document|file)")
    );
  }
  if (skill.name === "xlsx-workbooks") {
    return (
      hasInputExtension(input, ".xlsx") ||
      /\.xlsx\b/iu.test(task) ||
      taskRequestsFormat(
        task,
        "xlsx|excel\\s+(?:file|spreadsheet|workbook)|workbooks?|spreadsheets?",
      )
    );
  }
  if (skill.name === "pdf-documents") {
    return (
      hasInputExtension(input, ".pdf") ||
      /\.pdf\b/iu.test(task) ||
      taskRequestsFormat(task, "pdfs?|pdf\\s+(?:file|document|report|deliverable|attachment)")
    );
  }
  return undefined;
}

function skillApplies(skill: PromptSkill, input: SkillSelectionInput): boolean {
  if (input.requiredSkillNames?.includes(skill.name) === true) return true;
  const formatApplies = formatSkillApplies(skill, input);
  if (formatApplies !== undefined) return formatApplies;
  const evidence = [input.task, ...input.inputNames].join("\n");
  const evidenceTerms = routingTerms(evidence);
  const triggerText = skill.description.split(/\buse when\b/iu).at(-1) ?? skill.description;
  return [...routingTerms(triggerText)].some((term) => evidenceTerms.has(term));
}

function render(content: string, values: PromptValues): string {
  const rendered = content.replace(PLACEHOLDER, (_placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing prompt value: ${name}`);
    return String(value);
  });
  return rendered;
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

  recovery(name: string, values: PromptValues = {}): string {
    return render(this.required(this.recoveryPrompts, "recovery", name), values);
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

  private selectedSkills(input: SkillSelectionInput): PromptSkill[] {
    return this.skills.filter((skill) => skillApplies(skill, input));
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

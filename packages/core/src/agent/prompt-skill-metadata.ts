const METADATA_VALUE_LIMIT = 4_096;
const REPAIR_PATTERN_LIMIT = 240;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface SkillRepairTrigger {
  pattern: RegExp;
  prompt: string;
}

export interface ParsedSkillMetadata {
  body: string;
  description: string;
  name: string;
  repairTriggers: SkillRepairTrigger[];
  triggerExtensions: string[];
  triggerKeywords: string[];
  usesProgressMarkers: boolean;
}

function frontmatterValue(lines: string[], key: string): string | undefined {
  const prefix = `${key}:`;
  const values = lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  if (values.length > 1) throw new Error(`Duplicate skill metadata: ${key}`);
  const value = values[0];
  if (value === undefined || value.length === 0) return undefined;
  if (value.length > METADATA_VALUE_LIMIT) throw new Error(`Skill metadata is too long: ${key}`);
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function listValue(lines: string[], key: string): string[] {
  const value = frontmatterValue(lines, key);
  return value === undefined
    ? []
    : value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function safeRepairPattern(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= REPAIR_PATTERN_LIMIT &&
    !/(?:\([^)]*[+*][^)]*\))[+*{]|(?:\.\*){2}|(?:\.\+){2}/u.test(value)
  );
}

function repairTriggers(lines: string[]): SkillRepairTrigger[] {
  const value = frontmatterValue(lines, "repair-triggers");
  if (value === undefined) return [];
  return value.split(";;").map((entry) => {
    const separator = entry.lastIndexOf("=>");
    const source = entry.slice(0, separator).trim();
    const prompt = entry.slice(separator + 2).trim();
    if (separator < 1 || !safeRepairPattern(source) || !SKILL_NAME.test(prompt)) {
      throw new Error("Skill repair trigger is invalid.");
    }
    try {
      return { pattern: new RegExp(source, "iu"), prompt };
    } catch {
      throw new Error("Skill repair trigger is invalid.");
    }
  });
}

export function parseSkillMetadata(directoryName: string, content: string): ParsedSkillMetadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(content.trim());
  if (match === null) throw new Error(`Skill ${directoryName} has invalid frontmatter.`);
  const frontmatter = match[1]?.split(/\r?\n/u) ?? [];
  const name = frontmatterValue(frontmatter, "name");
  const description = frontmatterValue(frontmatter, "description");
  const body = match[2]?.trim() ?? "";
  const triggerExtensions = listValue(frontmatter, "trigger-extensions");
  const triggerKeywords = listValue(frontmatter, "trigger-keywords");
  const progressValue = frontmatterValue(frontmatter, "uses-progress-markers");
  if (
    name === undefined ||
    description === undefined ||
    name !== directoryName ||
    !SKILL_NAME.test(name) ||
    name.length > 64 ||
    description.length > 1_024 ||
    !/\buse when\b/iu.test(description) ||
    body.length === 0 ||
    triggerExtensions.some((extension) => !/^\.[a-z0-9]{1,16}$/u.test(extension)) ||
    triggerKeywords.some((keyword) => keyword.length > 80) ||
    (progressValue !== undefined && progressValue !== "true" && progressValue !== "false")
  ) {
    throw new Error(`Skill ${directoryName} does not satisfy the Agent Skills contract.`);
  }
  return {
    body,
    description,
    name,
    repairTriggers: repairTriggers(frontmatter),
    triggerExtensions,
    triggerKeywords,
    usesProgressMarkers: progressValue === "true",
  };
}

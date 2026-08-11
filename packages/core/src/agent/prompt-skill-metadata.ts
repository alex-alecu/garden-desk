const METADATA_VALUE_LIMIT = 4_096;
const REPAIR_PATTERN_LIMIT = 240;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface SkillRepairTrigger {
  pattern: RegExp;
  prompt: string;
}

export interface SkillSourceRejection {
  pattern: RegExp;
  reason: "invalid" | "progress_inside_loop" | "unsupported_document_api";
}

export interface SkillSourceRemoval {
  identifier: string;
  line: string;
}

export interface ParsedSkillMetadata {
  body: string;
  description: string;
  name: string;
  progressExcludeKeywords: string[];
  repairTriggers: SkillRepairTrigger[];
  sourceRejections: SkillSourceRejection[];
  sourceRemovals: SkillSourceRemoval[];
  triggerExtensions: string[];
  triggerKeywords: string[];
  usesProgressMarkers: boolean;
  producesDeliverables: boolean;
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

function metadataEntries(lines: string[], key: string): string[] {
  return (
    frontmatterValue(lines, key)
      ?.split(";;")
      .map((entry) => entry.trim()) ?? []
  );
}

function sourceRejections(lines: string[]): SkillSourceRejection[] {
  return metadataEntries(lines, "source-rejections").map((entry) => {
    const separator = entry.lastIndexOf("=>");
    const source = entry.slice(0, separator).trim();
    const reason = entry.slice(separator + 2).trim();
    if (
      separator < 1 ||
      !safeRepairPattern(source) ||
      !["invalid", "progress_inside_loop", "unsupported_document_api"].includes(reason)
    ) {
      throw new Error("Skill source rejection is invalid.");
    }
    try {
      return {
        pattern: new RegExp(source, "imu"),
        reason: reason as SkillSourceRejection["reason"],
      };
    } catch {
      throw new Error("Skill source rejection is invalid.");
    }
  });
}

function sourceRemovals(lines: string[]): SkillSourceRemoval[] {
  return metadataEntries(lines, "source-removals").map((entry) => {
    const separator = entry.lastIndexOf("=>");
    const line = entry.slice(0, separator).trim();
    const identifier = entry.slice(separator + 2).trim();
    if (separator < 1 || line.length > 240 || !/^[A-Za-z_]\w*$/u.test(identifier)) {
      throw new Error("Skill source removal is invalid.");
    }
    return { identifier, line };
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
  const progressExcludeKeywords = listValue(frontmatter, "progress-exclude-keywords");
  const progressValue = frontmatterValue(frontmatter, "uses-progress-markers");
  const deliverableValue = frontmatterValue(frontmatter, "produces-deliverables");
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
    progressExcludeKeywords.some((keyword) => keyword.length > 80) ||
    (progressValue !== undefined && progressValue !== "true" && progressValue !== "false") ||
    (deliverableValue !== undefined && deliverableValue !== "true" && deliverableValue !== "false")
  ) {
    throw new Error(`Skill ${directoryName} does not satisfy the Agent Skills contract.`);
  }
  return {
    body,
    description,
    name,
    progressExcludeKeywords,
    repairTriggers: repairTriggers(frontmatter),
    sourceRejections: sourceRejections(frontmatter),
    sourceRemovals: sourceRemovals(frontmatter),
    triggerExtensions,
    triggerKeywords,
    usesProgressMarkers: progressValue === "true",
    producesDeliverables: deliverableValue === "true",
  };
}

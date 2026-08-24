import type { AgentExecutionResult } from "@vault/shared";
import { artifactCandidateNames, isUserArtifactPath } from "./artifact-results.js";

const CREATION_VERB =
  /(?<!\.)\b(?:build|create|export|generate|make|produce|save|write)\b(?=\s|:)/giu;
const REQUIRED_DELIVERABLES = /\brequired\s+deliverables?\b/giu;
const FILENAME_TOKEN =
  /`([^`]+)`|"([^"]+)"|'([^']+)'|(?<!\S)([^\s,;:()[\]{}]+?)(?=[,;:()[\]{}]|\.(?=\s|$)|\s|$)/gu;
const DIRECT_OBJECT_END = /\r?\n|;|[.!?](?=\s|$)/u;
const INPUT_REFERENCE =
  /(?<!\S)(?:after\b|based\s+on\b|from\b|of\b|using\b|with\b|(?:source|input|attachment)(?=\s|:|$))/iu;
const LIST_ITEM = /^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/u;
const EXPLICIT_TARGET_BEFORE =
  /\b(?:(?:file|path|name|deliverable)\b(?:\s+(?:called|named|at|to))?|called|named)\s*(?::|=)?\s*$/iu;
const EXPLICIT_TARGET_AFTER = /^\s+(?:as\s+(?:a|the)\s+)?(?:file|path|name|deliverable)\b/iu;
const FILE_DESTINATION_BEFORE = /\bto\s+(?:(?:a|the)\s+)?(?:[^\s,;:()[\]{}]+\s+)*$/iu;
const FILE_DESTINATION_AFTER = /^\s+files?\b/iu;
const NEGATED_CREATION = /(?:\bdo\s+not|\bdon't|\bnever)\s*$/iu;
const MISSING_ARTIFACT_RECOVERY =
  "The previous answer was rejected because required current-run files are missing. Use available tools to complete the requested output, then return the completed result.";

function safeUserArtifactPath(value: string): string | undefined {
  return isUserArtifactPath(value) ? value : undefined;
}

function pathLike(name: string): boolean {
  return name.includes(".") || name.includes("/");
}

function explicitTarget(text: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0;
  return (
    EXPLICIT_TARGET_BEFORE.test(text.slice(0, start)) ||
    EXPLICIT_TARGET_AFTER.test(text.slice(start + match[0].length))
  );
}

function trailingTarget(text: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0;
  return text.slice(start + match[0].length).trim().length === 0;
}

function standaloneTarget(text: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0;
  const before = text.slice(0, start).trim();
  const after = text.slice(start + match[0].length).trim();
  return (before.length === 0 || before === ":" || before === "=") && after.length === 0;
}

function fileDestinationText(text: string, match: RegExpMatchArray): boolean {
  const start = match.index ?? 0;
  const end = start + match[0].length;
  return (
    FILE_DESTINATION_BEFORE.test(text.slice(0, start)) &&
    FILE_DESTINATION_AFTER.test(text.slice(end))
  );
}

function negatedCreation(task: string, match: RegExpMatchArray): boolean {
  return NEGATED_CREATION.test(task.slice(0, match.index));
}

function acceptedFilename(
  text: string,
  match: RegExpMatchArray,
  candidate: { name: string; quoted: boolean },
  allowExtensionless: boolean,
): boolean {
  const namedTarget = !fileDestinationText(text, match) && explicitTarget(text, match);
  if (namedTarget) return true;
  if (pathLike(candidate.name)) return candidate.quoted || trailingTarget(text, match);
  return allowExtensionless && (candidate.quoted || standaloneTarget(text, match));
}

function filenameTokens(text: string, allowExtensionless: boolean): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(FILENAME_TOKEN)) {
    const quoted = match[1] ?? match[2] ?? match[3];
    const token = quoted ?? match[4];
    if (token === undefined) continue;
    const name = safeUserArtifactPath(token);
    if (
      name !== undefined &&
      acceptedFilename(text, match, { name, quoted: quoted !== undefined }, allowExtensionless)
    ) {
      names.push(name);
    }
  }
  return names;
}

function directObjectText(text: string): string {
  const boundaries = [text.search(DIRECT_OBJECT_END), text.search(INPUT_REFERENCE)].filter(
    (index) => index !== -1,
  );
  return boundaries.length === 0 ? text : text.slice(0, Math.min(...boundaries));
}

function isQuote(character: string): boolean {
  return character === '"' || character === "'" || character === "`";
}

function nextQuote(quote: string | undefined, character: string): string | undefined {
  if (quote !== undefined) return character === quote ? undefined : quote;
  return isQuote(character) ? character : undefined;
}

function listSegments(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let quote: string | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) continue;
    const next = nextQuote(quote, character);
    if (next !== quote) {
      quote = next;
      continue;
    }
    if (quote === undefined && (character === "," || character === ";")) {
      segments.push(text.slice(start, index));
      start = index + 1;
    }
  }
  segments.push(text.slice(start));
  return segments;
}

function isInputSection(text: string): boolean {
  return /^\s*(?:#{1,6}\s*)?(?:source|input|attachment)s?(?=\s|:|$)/iu.test(text);
}

function requiredListNames(text: string): { names: string[]; stopped: boolean } {
  const names: string[] = [];
  for (const segment of listSegments(text)) {
    if (isInputSection(segment)) return { names, stopped: true };
    names.push(...filenameTokens(directObjectText(segment), true));
  }
  return { names, stopped: false };
}

function creationFilenames(task: string): string[] {
  const matches = [...task.matchAll(CREATION_VERB)];
  return matches.flatMap((match, index) => {
    if (match.index === undefined) return [];
    if (negatedCreation(task, match)) return [];
    const next = matches[index + 1]?.index;
    const directObject = directObjectText(task.slice(match.index + match[0].length, next));
    const name = filenameTokens(directObject, false)[0];
    return name === undefined ? [] : [name];
  });
}

function listItemText(line: string): string | undefined {
  return line.match(LIST_ITEM)?.[1];
}

function nextIsListItem(lines: readonly string[], start: number): boolean {
  for (const line of lines.slice(start)) {
    if (line.trim().length === 0) continue;
    return listItemText(line) !== undefined;
  }
  return false;
}

function listFilenames(lines: readonly string[]): string[] {
  const names: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) {
      if (nextIsListItem(lines, index + 1)) continue;
      break;
    }
    const item = listItemText(line);
    if (item === undefined) break;
    const parsed = requiredListNames(item);
    names.push(...parsed.names);
    if (parsed.stopped) break;
  }
  return names;
}

function requiredDeliverableFilenames(task: string): string[] {
  return [...task.matchAll(REQUIRED_DELIVERABLES)].flatMap((match) => {
    if (match.index === undefined) return [];
    const [inline = "", ...following] = task.slice(match.index + match[0].length).split(/\r?\n/u);
    const parsed = requiredListNames(inline);
    return parsed.stopped ? parsed.names : [...parsed.names, ...listFilenames(following)];
  });
}

export function requiredArtifactNames(task: string): string[] {
  return [...creationFilenames(task), ...requiredDeliverableFilenames(task)].filter(
    (name, index, names) => names.indexOf(name) === index,
  );
}

export function reservedArtifactCompletionTurn(
  requiredArtifacts: readonly string[],
  turn: number,
  turns: number,
): boolean {
  return requiredArtifacts.length > 0 && turns >= 4 && turn === turns - 3;
}

export function missingRequiredArtifacts(task: string, currentNames: readonly string[]): string[] {
  const current = new Set(currentNames);
  return requiredArtifactNames(task).filter((name) => !current.has(name));
}

export function missingArtifactRecovery(): string {
  return MISSING_ARTIFACT_RECOVERY;
}

export function currentArtifactNames(executions: readonly AgentExecutionResult[]): string[] {
  return artifactCandidateNames(executions).filter(isUserArtifactPath);
}

export function artifactCompletionRecovery(
  task: string,
  executions: readonly AgentExecutionResult[],
  recovery: { artifactRecoveryPending: boolean },
  finalTurn: boolean,
): string | false | undefined {
  const missing = missingRequiredArtifacts(task, currentArtifactNames(executions));
  if (missing.length === 0) return undefined;
  if (recovery.artifactRecoveryPending || finalTurn) {
    return false;
  }
  recovery.artifactRecoveryPending = true;
  return missingArtifactRecovery();
}

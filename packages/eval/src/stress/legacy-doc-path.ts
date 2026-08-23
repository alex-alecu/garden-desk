import { posix } from "node:path";

const DOCUMENT_ROOTS = ["/source", "/run/attachments"] as const;
const PATH_START = /^(?:Path|pathlib\.Path)\s*\(\s*((?:"[^"]*"|'[^']*'))\s*\)/u;
const PATH_JOIN = /^\s*\/\s*((?:"[^"]*"|'[^']*'))/u;
const PATH_CONSTRUCTOR = /\b(?:Path|pathlib\.Path)\s*\(/gu;
const GLOB = /^\s*\)?\s*\.glob\s*\(\s*["']\*\.doc["']\s*\)/iu;
const ITERDIR = /^\s*\)?\s*\.iterdir\s*\(\s*\)[\s\S]*(?:suffix|endswith)[\s\S]*["']\.doc["']/iu;

type ParsedPath = { length: number; path: string };

function literalValue(source: string): string | undefined {
  const match = /^(["'])([\s\S]*)\1$/u.exec(source.trim());
  const value = match?.[2];
  return value === undefined || value.includes("\\") ? undefined : value;
}

function initialPath(source: string): ParsedPath | undefined {
  const match = PATH_START.exec(source);
  if (match === null) return undefined;
  const path = literalValue(match[1] ?? "");
  return path === undefined ? undefined : { length: match[0].length, path };
}

function joinedPath(source: string, parsed: ParsedPath): ParsedPath | undefined {
  const match = PATH_JOIN.exec(source.slice(parsed.length));
  if (match === null) return undefined;
  const segment = literalValue(match[1] ?? "");
  if (segment === undefined) return undefined;
  const path = segment.startsWith("/") ? segment : posix.join(parsed.path, segment);
  return { length: parsed.length + match[0].length, path };
}

function constructedPath(source: string): ParsedPath | undefined {
  let parsed = initialPath(source);
  if (parsed === undefined) return undefined;
  for (;;) {
    const joined = joinedPath(source, parsed);
    if (joined === undefined) return { ...parsed, path: posix.normalize(parsed.path) };
    parsed = joined;
  }
}

function isBelowDocumentRoot(path: string, allowRoot: boolean): boolean {
  const normalized = posix.normalize(path);
  return DOCUMENT_ROOTS.some(
    (root) => (allowRoot && normalized === root) || normalized.startsWith(`${root}/`),
  );
}

export function approvedDocumentPath(value: string): boolean {
  const trimmed = value.trim();
  const literal = literalValue(trimmed);
  const parsed =
    literal === undefined ? constructedPath(trimmed) : { length: trimmed.length, path: literal };
  if (parsed?.length !== trimmed.length) return false;
  const normalized = posix.normalize(parsed.path);
  return (
    isBelowDocumentRoot(normalized, false) && posix.extname(normalized).toLowerCase() === ".doc"
  );
}

function hasApprovedDiscovery(value: string, method: RegExp): boolean {
  for (const match of value.matchAll(PATH_CONSTRUCTOR)) {
    const parsed = constructedPath(value.slice(match.index));
    if (parsed === undefined || !isBelowDocumentRoot(parsed.path, true)) continue;
    if (method.test(value.slice(match.index + parsed.length))) return true;
  }
  return false;
}

export const hasApprovedGlobDiscovery = (value: string): boolean =>
  hasApprovedDiscovery(value, GLOB);

export const hasApprovedIterdirDiscovery = (value: string): boolean =>
  hasApprovedDiscovery(value, ITERDIR);

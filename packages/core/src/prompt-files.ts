import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readPromptFile(path: string): string {
  return readFileSync(path, "utf8");
}

export function promptMarkdownFiles(directory: string): Array<{ name: string; path: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }));
}

export function promptSkillDirectories(directory: string): Array<{ name: string; path: string }> {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(directory, entry.name) }));
}

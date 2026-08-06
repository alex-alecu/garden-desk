import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function readPromptFile(path: string): string {
  return readFileSync(path, "utf8");
}

export function promptDirectoryExists(path: string): boolean {
  return existsSync(path);
}

export function readSourceFiles(directory: string): Array<{ path: string; content: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return readSourceFiles(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [{ path, content: readFileSync(path, "utf8") }];
  });
}

export function directoryFileNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
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

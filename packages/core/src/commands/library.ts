import { basename } from "node:path";
import { type CommandSummary, CommandSummarySchema } from "@gardendesk/shared";
import { promptMarkdownFiles, readPromptFile } from "../prompt-files.js";

interface CommandDefinition extends CommandSummary {
  workflow: "agent" | "document-review";
  agent?: string;
  body: string;
}

export interface CommandInvocation extends CommandDefinition {
  arguments: string;
}

function commandMetadata(header: string, path: string): Map<string, string> {
  const metadata = new Map<string, string>();
  for (const line of header.split("\n")) {
    const field = /^(description|workflow|agent):\s*(.+)$/u.exec(line);
    const key = field?.[1];
    const value = field?.[2];
    if (key === undefined || value === undefined || metadata.has(key)) {
      throw new Error(`Invalid command metadata: ${path}`);
    }
    metadata.set(key, value.trim());
  }
  return metadata;
}

function readCommand(path: string): CommandDefinition {
  const content = readPromptFile(path).replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]+?)\n---\n([\s\S]*)$/u.exec(content);
  const header = match?.[1];
  const body = match?.[2]?.trim();
  if (header === undefined || body === undefined)
    throw new Error(`Invalid command Markdown: ${path}`);
  const metadata = commandMetadata(header, path);
  const workflow = metadata.get("workflow") ?? "agent";
  if (workflow !== "agent" && workflow !== "document-review") {
    throw new Error(`Unsupported command workflow: ${path}`);
  }
  const agent = metadata.get("agent");
  if (agent !== undefined) validateAgent(agent, workflow, path);
  if (agent === undefined && body.length === 0)
    throw new Error(`Missing command instructions: ${path}`);
  return {
    ...CommandSummarySchema.parse({
      name: basename(path, ".md"),
      description: metadata.get("description"),
    }),
    workflow,
    ...(agent === undefined ? {} : { agent }),
    body,
  };
}

function validateAgent(agent: string, workflow: string, path: string): void {
  if (workflow !== "agent" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(agent))
    throw new Error(`Invalid command agent: ${path}`);
}

export class CommandLibrary {
  private readonly definitions: CommandDefinition[];

  constructor(directory: string) {
    this.definitions = promptMarkdownFiles(directory)
      .map(({ path }) => readCommand(path))
      .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  }

  list(): CommandSummary[] {
    return this.definitions.map(({ name, description }) => ({ name, description }));
  }

  resolve(task: string): CommandInvocation | undefined {
    const match = /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/u.exec(task.trim());
    if (!match) return undefined;
    const definition = this.definitions.find(({ name }) => name === match[1]);
    if (!definition) throw new Error("command_not_found");
    return { ...definition, arguments: match[2]?.trim() ?? "" };
  }
}

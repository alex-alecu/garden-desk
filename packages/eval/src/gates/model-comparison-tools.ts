import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repository = process.cwd();

function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function tool(name: string, description: string, params: unknown) {
  return { type: "function", function: { name, description, parameters: params } };
}

async function agentTools() {
  const agents: Array<{ name: string; description: string }> = [];
  const root = join(repository, "prompts/agents");
  for (const file of (await readdir(root)).sort()) {
    const text = await readFile(join(root, file), "utf8");
    const name = /^name: (.+)$/mu.exec(text)?.[1];
    const description = /^description: (.+)$/mu.exec(text)?.[1];
    if (name && description && /^mode: subagent$/mu.test(text)) agents.push({ name, description });
  }
  return agents;
}

const path = { type: "string" };

export function inspectionTools() {
  return [
    tool(
      "read",
      "Read a file by line range. DOC, DOCX, and PDF return their extracted text; any other file must be UTF-8 text. Offset defaults to 1; limit defaults to 2000, clamped to 1-2000.",
      objectSchema(
        {
          path,
          offset: { type: "integer", minimum: 1, default: 1 },
          limit: { type: "integer", minimum: 1, maximum: 2000, default: 2000 },
        },
        ["path"],
      ),
    ),
    tool(
      "glob",
      "Find guest paths using a glob pattern.",
      objectSchema({ pattern: { type: "string" }, path }, ["pattern"]),
    ),
    tool(
      "grep",
      "Search guest file contents with a regular expression. Include defaults to *; when set, use non-empty text up to 4096 characters.",
      objectSchema({ pattern: { type: "string" }, path, include: { type: "string" } }, ["pattern"]),
    ),
    tool(
      "list",
      "List files and directories under a guest path. Depth defaults to 2; safe integers are clamped to 0-8.",
      objectSchema({ path, depth: { type: "integer", minimum: 0, maximum: 8, default: 2 } }),
    ),
  ];
}

export function actionTools() {
  return [
    tool(
      "write",
      "Write a complete UTF-8 file under /workspace.",
      objectSchema({ path, content: { type: "string" } }, ["path", "content"]),
    ),
    tool(
      "bash",
      "Run a complete /bin/sh command inside the no-network guest. Commands start in /workspace; use /source for the selected folder.",
      objectSchema({ command: { type: "string" } }, ["command"]),
    ),
    tool(
      "python",
      "Run python offline. No path: run once. Source+path: save. Path only: run.",
      objectSchema({
        source: { type: "string" },
        path: {
          type: "string",
          description:
            "Relative or /workspace/... path to save to or run from; /source/... path to run a live source file directly.",
        },
      }),
    ),
    tool(
      "review",
      "Review one DOC, DOCX, text PDF, TXT, or MD document for the requested purpose, by default its internal inconsistencies. Extracts the file itself, including binary DOC; call it before any skill or extraction. Returns findings and a numbered text path. No calculations or image inspection.",
      objectSchema({ path, prompt: { type: "string" } }, ["path", "prompt"]),
    ),
  ];
}

export async function taskTool() {
  const agents = await agentTools();
  return tool(
    "task",
    "Delegate a separate body of work to the matching specialist before processing files yourself. Give the request, exact source paths, expected findings, and known limits. Children run one at a time.",
    objectSchema(
      {
        description: { type: "string" },
        prompt: { type: "string" },
        subagent_type: {
          type: "string",
          enum: agents.map((agent) => agent.name),
          description: agents.map((agent) => `${agent.name}: ${agent.description}`).join("\n"),
        },
      },
      ["description", "prompt", "subagent_type"],
    ),
  );
}

export async function primaryPrompt() {
  const text = await readFile(join(repository, "prompts/agents/primary.md"), "utf8");
  return text.slice(text.indexOf("\n---", 4) + 4).trim();
}

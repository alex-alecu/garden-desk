import { randomUUID } from "node:crypto";
import {
  type AgentExecutionResult,
  type AgentQuestion,
  AgentWorkspacePathSchema,
  type ChatToolDefinition,
} from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import type { AgentExecutor } from "./agent-executor.js";

export interface SkillReader {
  metadata(): Array<{ name: string; description: string }>;
  read(name: string): string;
}

export interface SubagentRequest {
  description: string;
  prompt: string;
  subagentType: "explore" | "general" | "probe";
}

export type AgentQuestionOutcome = { dismissed: false; answers: string[][] } | { dismissed: true };

export interface AgentToolResult {
  content: string;
  failed: boolean;
  invalidInput?: boolean;
  execution?: AgentExecutionResult;
  status?: "already_loaded";
}

export interface ToolContext {
  executor: AgentExecutor;
  skills: SkillReader;
  inspectImage?(path: string, prompt: string): Promise<string>;
  spawnTask?(request: SubagentRequest): Promise<string>;
  askQuestion?(questions: AgentQuestion[]): Promise<AgentQuestionOutcome>;
  signal?: AbortSignal;
}

export interface ToolSpec {
  definition: ChatToolDefinition;
  parse(value: unknown): unknown;
  execute(value: unknown, context: ToolContext): Promise<AgentToolResult>;
}

type InspectionName = "read" | "glob" | "grep" | "list";

export function objectSchema(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function executionText(result: AgentExecutionResult): string {
  return [
    `exit_code: ${result.exitCode}`,
    `termination: ${result.termination}`,
    result.stdout.length > 0 ? `stdout:\n${result.stdout}` : "stdout: (empty)",
    result.stderr.length > 0 ? `stderr:\n${result.stderr}` : "stderr: (empty)",
  ].join("\n");
}

export async function runExecution(
  context: ToolContext,
  execution: AgentSessionExecution,
  recorded: boolean,
): Promise<AgentToolResult> {
  const execute = recorded
    ? context.executor.execute
    : (context.executor.inspect ?? context.executor.execute);
  const result = await execute(execution, context.signal);
  return {
    content: executionText(result),
    failed: result.termination !== "completed" || result.exitCode !== 0,
    ...(recorded ? { execution: result } : {}),
  };
}

export function scriptPath(language: "python" | "node", value?: string): string {
  return AgentWorkspacePathSchema.parse(
    value ?? `.vault-tools/${language}-${randomUUID()}.${language === "python" ? "py" : "js"}`,
  );
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("tool_arguments_must_be_an_object");
  }
  return value as Record<string, unknown>;
}

export function textParam(value: Record<string, unknown>, name: string, maximum = 128_000): string {
  const item = value[name];
  if (typeof item !== "string" || item.length === 0 || item.length > maximum) {
    throw new Error(`invalid_${name}`);
  }
  return item;
}

export function optionalText(value: Record<string, unknown>, name: string): string | undefined {
  const item = value[name];
  if (item === undefined) return undefined;
  if (typeof item !== "string" || item.length === 0 || item.length > 4_096) {
    throw new Error(`invalid_${name}`);
  }
  return item;
}

function optionalBoundedInteger(
  value: Record<string, unknown>,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const item = value[name];
  if (item === undefined) return undefined;
  if (!Number.isSafeInteger(item)) {
    throw new Error(`invalid_${name}`);
  }
  return Math.max(minimum, Math.min(maximum, item as number));
}

function inspectionSource(operation: InspectionName, params: unknown): string {
  return [
    "from pathlib import Path",
    "import fnmatch, json, re",
    `op = ${JSON.stringify(operation)}`,
    `args = json.loads(${JSON.stringify(JSON.stringify(params))})`,
    "def safe(value, default='/source'):",
    "    raw = str(value or default)",
    "    path = Path(raw if raw.startswith('/') else '/source/' + raw)",
    "    resolved = path.resolve()",
    "    roots = (Path('/source'), Path('/workspace'), Path('/run/attachments'))",
    "    if resolved not in roots and not str(resolved).startswith(tuple(str(root) + '/' for root in roots)):",
    "        raise ValueError('path_outside_guest_roots')",
    "    return resolved",
    "root = safe(args.get('path'))",
    "if op == 'read':",
    "    lines = root.read_text(errors='replace').splitlines()",
    "    offset = max(1, int(args.get('offset', 1)))",
    "    limit = max(1, min(2000, int(args.get('limit', 2000))))",
    "    for number, line in enumerate(lines[offset - 1:offset - 1 + limit], offset): print(f'{number}: {line}')",
    "elif op == 'glob':",
    "    pattern = args['pattern']",
    "    for item in sorted(root.glob(pattern)): print(item)",
    "elif op == 'grep':",
    "    regex = re.compile(args['pattern'])",
    "    include = args.get('include', '*')",
    "    files = [root] if root.is_file() else sorted(p for p in root.rglob('*') if p.is_file() and fnmatch.fnmatch(p.name, include))",
    "    for item in files:",
    "        try:",
    "            for number, line in enumerate(item.read_text(errors='replace').splitlines(), 1):",
    "                if regex.search(line): print(f'{item}:{number}:{line}')",
    "        except OSError as error: print(f'{item}: {error}')",
    "else:",
    "    depth = max(0, min(8, int(args.get('depth', 2))))",
    "    for item in sorted(root.rglob('*')):",
    "        if len(item.relative_to(root).parts) <= depth: print(str(item) + ('/' if item.is_dir() else ''))",
  ].join("\n");
}

function inspectionTool(options: {
  name: InspectionName;
  parse(value: unknown): Record<string, unknown>;
  properties: Record<string, unknown>;
  required: string[];
  description: string;
}): ToolSpec {
  return {
    definition: {
      name: options.name,
      description: options.description,
      params: objectSchema(options.properties, options.required),
    },
    parse: options.parse,
    execute: async (value, context) => {
      const params = options.parse(value);
      return await runExecution(
        context,
        {
          language: "python",
          path: `.vault-tools/${options.name}-${randomUUID()}.py`,
          source: inspectionSource(options.name, params),
        },
        false,
      );
    },
  };
}

function readParams(value: unknown) {
  const params = object(value);
  return {
    path: textParam(params, "path", 4_096),
    offset: optionalBoundedInteger(params, "offset", 1, Number.MAX_SAFE_INTEGER),
    limit: optionalBoundedInteger(params, "limit", 1, 2_000),
  };
}

function patternParams(value: unknown, include = false) {
  const params = object(value);
  return {
    pattern: textParam(params, "pattern", 4_096),
    path: optionalText(params, "path"),
    ...(include ? { include: optionalText(params, "include") } : {}),
  };
}

export function inspectionTools(): ToolSpec[] {
  return [
    inspectionTool({
      name: "read",
      parse: readParams,
      properties: {
        path: { type: "string" },
        offset: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 2_000 },
      },
      required: ["path"],
      description: "Read a guest file by line range.",
    }),
    inspectionTool({
      name: "glob",
      parse: (value) => patternParams(value),
      properties: { pattern: { type: "string" }, path: { type: "string" } },
      required: ["pattern"],
      description: "Find guest paths using a glob pattern.",
    }),
    inspectionTool({
      name: "grep",
      parse: (value) => patternParams(value, true),
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        include: { type: "string" },
      },
      required: ["pattern"],
      description: "Search guest file contents with a regular expression.",
    }),
    inspectionTool({
      name: "list",
      parse: (value) => {
        const params = object(value);
        return {
          path: optionalText(params, "path"),
          depth: optionalBoundedInteger(params, "depth", 0, 8),
        };
      },
      properties: { path: { type: "string" }, depth: { type: "integer", minimum: 0, maximum: 8 } },
      required: [],
      description: "List files and directories under a guest path.",
    }),
  ];
}

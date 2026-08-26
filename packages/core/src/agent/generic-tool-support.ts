import { randomUUID } from "node:crypto";
import {
  type AgentExecutionResult,
  type AgentQuestion,
  AgentWorkspacePathSchema,
  type ChatToolDefinition,
} from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import {
  AgentExecutionAttemptError,
  type AgentExecutor,
  agentScriptPreparationFailure,
} from "./agent-executor.js";
import { isSuccessfulExecution } from "./execution-success.js";
import { type InspectionName, inspectionSource } from "./generic-inspection-source.js";

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
  artifactExecution?: AgentExecutionResult;
  executionFailure?: {
    termination: AgentExecutionResult["termination"];
    exitCode: number;
    errorText: string;
  };
  executionAttempt?: AgentExecutionAttemptError["attempt"];
  status?: "already_loaded";
}

export interface ToolExecutionResult extends AgentToolResult {
  guestExecutionsStarted?: number;
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
  execute(value: unknown, context: ToolContext): Promise<ToolExecutionResult>;
}

export type ToolValidation =
  | { status: "invalid"; result: AgentToolResult }
  | { status: "valid"; parsed: unknown; tool: ToolSpec };

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

function executionResult(
  result: AgentExecutionResult,
  recorded: boolean,
  guestExecutionsStarted: number,
): ToolExecutionResult {
  const failed = !isSuccessfulExecution(result);
  return {
    content: executionText(result),
    failed,
    guestExecutionsStarted,
    ...(recorded ? { execution: result } : { artifactExecution: result }),
    ...(failed
      ? {
          executionFailure: {
            termination: result.termination,
            exitCode: result.exitCode,
            errorText: result.stderr || result.stdout || "Execution failed without output.",
          },
        }
      : {}),
  };
}

function preparationError(error: unknown): ToolExecutionResult | undefined {
  const preparation = agentScriptPreparationFailure(error);
  if (preparation === undefined) return undefined;
  return {
    content: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    failed: true,
    guestExecutionsStarted: 0,
  };
}

function executionError(error: unknown, guestExecutionsStarted: number): ToolExecutionResult {
  const preparation = preparationError(error);
  if (preparation !== undefined) return preparation;
  return {
    content: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    failed: true,
    guestExecutionsStarted,
  };
}

export async function runExecution(
  context: ToolContext,
  execution: AgentSessionExecution,
  recorded: boolean,
): Promise<ToolExecutionResult> {
  const execute = recorded
    ? context.executor.execute
    : (context.executor.inspect ?? context.executor.execute);
  let guestExecutionsStarted = 0;
  const onStarted = () => {
    guestExecutionsStarted = 1;
  };
  try {
    const result = await execute(execution, context.signal, onStarted);
    onStarted();
    return executionResult(result, recorded, guestExecutionsStarted);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof AgentExecutionAttemptError) {
      return {
        content: `${error.name}: ${error.message}`,
        failed: true,
        guestExecutionsStarted,
        executionAttempt: error.attempt,
      };
    }
    return executionError(error, guestExecutionsStarted);
  }
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
    throw new Error(`invalid_${name}: use non-empty text with at most 4096 characters`);
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
  if (typeof item !== "number" || !Number.isSafeInteger(item)) {
    throw new Error(`invalid_${name}: use an integer from ${minimum} to ${maximum}`);
  }
  return Math.min(maximum, Math.max(minimum, item));
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
      const params = value as Record<string, unknown>;
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one tool catalog keeps its schemas visible together.
export function inspectionTools(): ToolSpec[] {
  return [
    inspectionTool({
      name: "read",
      parse: readParams,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        offset: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 2_000, default: 2_000 },
      },
      required: ["path"],
      description:
        "Read UTF-8 plain text by line range. Offset defaults to 1; safe integers are clamped to the listed bounds.",
    }),
    inspectionTool({
      name: "glob",
      parse: (value) => patternParams(value),
      properties: {
        pattern: { type: "string", minLength: 1, maxLength: 4_096 },
        path: { type: "string", minLength: 1, maxLength: 4_096 },
      },
      required: ["pattern"],
      description: "Find guest paths using a glob pattern.",
    }),
    inspectionTool({
      name: "grep",
      parse: (value) => patternParams(value, true),
      properties: {
        pattern: { type: "string", minLength: 1, maxLength: 4_096 },
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        include: { type: "string", minLength: 1, maxLength: 4_096 },
      },
      required: ["pattern"],
      description:
        "Search guest file contents with a regular expression. Include defaults to *; when set, use non-empty text up to 4096 characters.",
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
      properties: {
        path: { type: "string", minLength: 1, maxLength: 4_096 },
        depth: { type: "integer", minimum: 0, maximum: 8, default: 2 },
      },
      required: [],
      description:
        "List files and directories under a guest path. Depth defaults to 2; safe integers are clamped to 0-8.",
    }),
  ];
}

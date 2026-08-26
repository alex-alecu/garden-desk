import type { ChatToolDefinition } from "@vault/shared";
import {
  type AgentToolResult,
  inspectionTools,
  object,
  objectSchema,
  runExecution,
  type SkillReader,
  scriptPath,
  type ToolContext,
  type ToolExecutionResult,
  type ToolSpec,
  type ToolValidation,
  textParam,
} from "./generic-tool-support.js";
import type { GuestExecutionBudget } from "./guest-execution-budget.js";
import { questionTool } from "./question-tool.js";
import { boundedToolOutput } from "./tool-output.js";

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function invalidValidation(content: string): ToolValidation {
  return { status: "invalid", result: { content, failed: true, invalidInput: true } };
}

function failedOutputResult(
  error: unknown,
  completed: ToolExecutionResult | undefined,
): AgentToolResult {
  const result = {
    ...(completed ?? {}),
    content: errorText(error),
    failed: true,
  };
  delete result.guestExecutionsStarted;
  return result;
}

export type {
  AgentQuestionOutcome,
  AgentToolResult,
  SkillReader,
  SubagentRequest,
  ToolValidation,
} from "./generic-tool-support.js";

function codeParams(
  language: "python" | "node",
  value: unknown,
): { source?: string; path?: string } {
  const params = object(value);
  const source = params.source === undefined ? undefined : textParam(params, "source");
  const path =
    params.path === undefined ? undefined : scriptPath(language, textParam(params, "path", 1_000));
  if (source === undefined && path === undefined) throw new Error("source_or_path_required");
  return { ...(source === undefined ? {} : { source }), ...(path === undefined ? {} : { path }) };
}

function codeTool(language: "python" | "node"): ToolSpec {
  return {
    definition: {
      name: language,
      description: `Run ${language} offline. Source runs now; source plus path saves; path runs committed bytes. Use /workspace and /source.`,
      params: objectSchema(
        {
          source: { type: "string" },
          path: {
            type: "string",
            description: "Relative workspace path. Use steps/... for reusable work.",
          },
        },
        [],
      ),
    },
    parse: (value) => codeParams(language, value),
    execute: async (value, context) => {
      const params = value as ReturnType<typeof codeParams>;
      const path = params.path ?? scriptPath(language);
      return await runExecution(
        context,
        params.source === undefined
          ? { language, path }
          : { language, path, source: params.source },
        true,
      );
    },
  };
}

function bashParams(value: unknown): { command: string } {
  return { command: textParam(object(value), "command") };
}

function bashTool(): ToolSpec {
  return {
    definition: {
      name: "bash",
      description:
        "Run a complete /bin/sh command inside the no-network guest. Commands start in /workspace; use /source explicitly for the selected folder.",
      params: objectSchema({ command: { type: "string" } }, ["command"]),
    },
    parse: bashParams,
    execute: async (value, context) => {
      const { command } = value as ReturnType<typeof bashParams>;
      return await runExecution(context, { language: "shell", command }, true);
    },
  };
}

function skillDefinition(skillNames: string[]): ChatToolDefinition {
  return {
    name: "skill",
    description: "Load specialized instructions on demand.",
    params: objectSchema({ name: { type: "string", enum: skillNames } }, ["name"]),
  };
}

function skillTool(skills: SkillReader, skillNames: string[]): ToolSpec {
  return {
    definition: skillDefinition(skillNames),
    parse: (value) => {
      const name = textParam(object(value), "name", 64);
      if (!skillNames.includes(name)) throw new Error("unknown_skill");
      return { name };
    },
    execute: async (value) => ({
      content: skills.read((value as { name: string }).name),
      failed: false,
    }),
  };
}

function taskParams(value: unknown): {
  description: string;
  prompt: string;
  subagent_type: "explore" | "general" | "probe";
} {
  const params = object(value);
  const subagentType = textParam(params, "subagent_type", 16);
  if (subagentType !== "explore" && subagentType !== "general" && subagentType !== "probe") {
    throw new Error("invalid_subagent_type");
  }
  return {
    description: textParam(params, "description", 1_000),
    prompt: textParam(params, "prompt"),
    subagent_type: subagentType,
  };
}

function taskTool(): ToolSpec {
  return {
    definition: {
      name: "task",
      description:
        "Delegate isolated exploration, a focused trial, or one independent multi-step work unit. Only the final report returns to this context; verify child outputs before final use.",
      params: objectSchema(
        {
          description: { type: "string" },
          prompt: { type: "string" },
          subagent_type: { type: "string", enum: ["explore", "general", "probe"] },
        },
        ["description", "prompt", "subagent_type"],
      ),
    },
    parse: taskParams,
    execute: async (value, context) => {
      if (context.spawnTask === undefined) {
        return { content: "Sub-agents are unavailable from this agent.", failed: true };
      }
      const params = value as ReturnType<typeof taskParams>;
      const report = await context.spawnTask({
        description: params.description,
        prompt: params.prompt,
        subagentType: params.subagent_type,
      });
      return { content: `<task_result>\n${report}\n</task_result>`, failed: false };
    },
  };
}

function imageTool(): ToolSpec {
  return {
    definition: {
      name: "image",
      description:
        "Inspect one PNG or JPEG from /run/attachments or /source. Return only image facts needed for the task.",
      params: objectSchema(
        {
          path: { type: "string", description: "Exact guest image path." },
          prompt: {
            type: "string",
            description: "Specific visual question or extraction request.",
          },
        },
        ["path", "prompt"],
      ),
    },
    parse: (value) => {
      const params = object(value);
      return {
        path: textParam(params, "path", 4_096),
        prompt: textParam(params, "prompt", 16_384),
      };
    },
    execute: async (value, context) => {
      if (context.inspectImage === undefined) {
        return { content: "Image inspection is not available.", failed: true };
      }
      const params = value as { path: string; prompt: string };
      return { content: await context.inspectImage(params.path, params.prompt), failed: false };
    },
  };
}

function specs(skills: SkillReader, skillNames: string[]): ToolSpec[] {
  return [
    codeTool("python"),
    codeTool("node"),
    bashTool(),
    ...inspectionTools(),
    imageTool(),
    skillTool(skills, skillNames),
    taskTool(),
    questionTool(),
  ];
}

export class GenericToolRegistry {
  private readonly skillNames: string[];
  private readonly tools: Map<string, ToolSpec>;
  constructor(private readonly context: ToolContext) {
    this.skillNames = context.skills.metadata().map((item) => item.name);
    this.tools = new Map(
      specs(context.skills, this.skillNames).map((tool) => [tool.definition.name, tool]),
    );
  }
  definitions(
    names: readonly string[],
    loadedSkills: ReadonlySet<string> = new Set<string>(),
  ): ChatToolDefinition[] {
    const definitions: ChatToolDefinition[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool === undefined) throw new Error(`Unknown agent tool: ${name}`);
      if (name === "skill") {
        const available = this.skillNames.filter((skill) => !loadedSkills.has(skill));
        if (available.length > 0) definitions.push(skillDefinition(available));
      } else {
        definitions.push(tool.definition);
      }
    }
    return definitions;
  }
  validate(name: string, params: unknown): ToolValidation {
    const tool = this.tools.get(name);
    if (tool === undefined) return invalidValidation(`Unknown tool: ${name}`);
    try {
      return { status: "valid", parsed: tool.parse(params), tool };
    } catch (error) {
      return invalidValidation(errorText(error));
    }
  }
  async execute(
    name: string,
    params: unknown,
    budget?: GuestExecutionBudget,
    validation?: ToolValidation,
  ): Promise<AgentToolResult> {
    const checked = validation ?? this.validate(name, params);
    if (checked.status === "invalid") return checked.result;
    let guestExecutionsStarted = 0;
    let completed: ToolExecutionResult | undefined;
    try {
      const result = await checked.tool.execute(checked.parsed, this.context);
      completed = result;
      guestExecutionsStarted = result.guestExecutionsStarted ?? 0;
      budget?.recordStarted(guestExecutionsStarted);
      const content = await boundedToolOutput(
        this.context.executor,
        result.content,
        this.context.signal,
        {
          ...(budget === undefined ? {} : { budget }),
          onGuestExecutionStarted: () => {
            guestExecutionsStarted += 1;
          },
        },
      );
      const output = { ...result, content };
      delete output.guestExecutionsStarted;
      return output;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return failedOutputResult(error, completed);
    }
  }
}

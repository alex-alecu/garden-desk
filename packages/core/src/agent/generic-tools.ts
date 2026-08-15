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
  type ToolSpec,
  textParam,
} from "./generic-tool-support.js";
import { questionTool } from "./question-tool.js";
import { boundedToolOutput } from "./tool-output.js";

export type {
  AgentQuestionOutcome,
  AgentToolResult,
  SkillReader,
  SubagentRequest,
} from "./generic-tool-support.js";

function codeParams(value: unknown): { source: string } {
  return { source: textParam(object(value), "source") };
}

function codeTool(language: "python" | "node"): ToolSpec {
  return {
    definition: {
      name: language,
      description: `Run a complete ${language} program inside the no-network guest. Programs start in /workspace; read the selected folder through absolute /source paths.`,
      params: objectSchema(
        { source: { type: "string", description: "Complete runnable source code." } },
        ["source"],
      ),
    },
    parse: codeParams,
    execute: async (value, context) => {
      const params = codeParams(value);
      return await runExecution(
        context,
        { language, path: scriptPath(language), source: params.source },
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
    execute: async (value, context) =>
      await runExecution(context, { language: "shell", command: bashParams(value).command }, true),
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
  async execute(name: string, params: unknown): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      return { content: `Unknown tool: ${name}`, failed: true, invalidInput: true };
    }
    let parsed: unknown;
    try {
      parsed = tool.parse(params);
    } catch (error) {
      return {
        content: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        failed: true,
        invalidInput: true,
      };
    }
    try {
      const result = await tool.execute(parsed, this.context);
      const content = await boundedToolOutput(
        this.context.executor,
        result.content,
        this.context.signal,
      );
      return { ...result, content };
    } catch (error) {
      return {
        content: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        failed: true,
      };
    }
  }
}

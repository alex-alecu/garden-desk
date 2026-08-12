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

function skillTool(skills: SkillReader): ToolSpec {
  const skillNames = skills.metadata().map((item) => item.name);
  return {
    definition: {
      name: "skill",
      description: "Load specialized instructions on demand.",
      params: objectSchema({ name: { type: "string", enum: skillNames } }, ["name"]),
    },
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
  subagent_type: "explore" | "probe";
} {
  const params = object(value);
  const subagentType = textParam(params, "subagent_type", 16);
  if (subagentType !== "explore" && subagentType !== "probe") {
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
        "Delegate isolated exploration or trial-and-error work. Only the final report returns to this context.",
      params: objectSchema(
        {
          description: { type: "string" },
          prompt: { type: "string" },
          subagent_type: { type: "string", enum: ["explore", "probe"] },
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

function specs(skills: SkillReader): ToolSpec[] {
  return [
    codeTool("python"),
    codeTool("node"),
    bashTool(),
    ...inspectionTools(),
    skillTool(skills),
    taskTool(),
    questionTool(),
  ];
}

export class GenericToolRegistry {
  private readonly tools: Map<string, ToolSpec>;
  constructor(private readonly context: ToolContext) {
    this.tools = new Map(specs(context.skills).map((tool) => [tool.definition.name, tool]));
  }
  definitions(names: readonly string[]): ChatToolDefinition[] {
    return names.map((name) => {
      const tool = this.tools.get(name);
      if (tool === undefined) throw new Error(`Unknown agent tool: ${name}`);
      return tool.definition;
    });
  }
  async execute(name: string, params: unknown): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (tool === undefined) return { content: `Unknown tool: ${name}`, failed: true };
    try {
      const result = await tool.execute(tool.parse(params), this.context);
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

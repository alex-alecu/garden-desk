function skillRequestSchema(skillNames: readonly string[]) {
  return {
    type: "array",
    items: { type: "string", enum: skillNames },
    maxItems: Math.min(8, skillNames.length),
    uniqueItems: true,
  } as const;
}

function finalResponseSchema(artifactNames: readonly string[], skillNames: readonly string[]) {
  const artifacts =
    artifactNames.length === 0
      ? { type: "array", maxItems: 0 }
      : {
          type: "array",
          items: { type: "string", enum: artifactNames },
          maxItems: Math.min(16, artifactNames.length),
          uniqueItems: true,
        };
  return {
    type: "object",
    properties: {
      action: { const: "respond" },
      response: {
        type: "array",
        items: { type: "string", maxLength: 512 },
        minItems: 1,
        maxItems: 100,
      },
      artifacts,
      skills: skillRequestSchema(skillNames),
    },
    required: ["action", "response", "artifacts", "skills"],
    additionalProperties: false,
  } as const;
}

export const SHELL_COMMAND_CHARACTER_LIMIT = 4_096;

function sourceExecutionSchemaBase(skillNames: readonly string[]) {
  return {
    type: "object",
    properties: {
      action: { const: "execute" },
      language: { enum: ["python", "node"] },
      summary: { type: "string", minLength: 1, maxLength: 500 },
      skills: skillRequestSchema(skillNames),
      path: { type: "string", minLength: 1, maxLength: 1_000 },
      source: {
        type: "array",
        items: { type: "string", maxLength: 512 },
        minItems: 1,
        maxItems: 250,
      },
    },
    required: ["action", "language", "source", "summary", "skills"],
    additionalProperties: false,
  } as const;
}

function shellExecutionSchema(skillNames: readonly string[]) {
  return {
    type: "object",
    properties: {
      action: { const: "execute" },
      language: { const: "shell" },
      command: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 1,
      },
      summary: { type: "string", minLength: 1, maxLength: 500 },
      skills: skillRequestSchema(skillNames),
    },
    required: ["action", "language", "command", "summary", "skills"],
    additionalProperties: false,
  } as const;
}

export const GENERATION_LIMIT_RECOVERY_SOURCE_LINES = 64;

function namedSourceLanguage(task: string): "python" | "node" | undefined {
  const python = /\bpython\b/iu.test(task);
  const node = /\bnode(?:\.js)?\b/iu.test(task);
  if (python === node) return undefined;
  return python ? "python" : "node";
}

function sourceExecutionSchema(
  language: "python" | "node" | undefined,
  boundedSource: boolean,
  skillNames: readonly string[],
) {
  const base = sourceExecutionSchemaBase(skillNames);
  return {
    ...base,
    properties: {
      ...base.properties,
      ...(language === undefined ? {} : { language: { const: language } }),
      source: {
        ...base.properties.source,
        maxItems: boundedSource ? 160 : base.properties.source.maxItems,
      },
    },
  } as const;
}

interface AgentDecisionSchemaOptions {
  artifactNames: readonly string[];
  finalResponse: boolean;
  requiredLanguage?: "python" | "node";
  requiresSourceExecution: boolean;
  skillNames: readonly string[];
  sourceLineLimit?: number;
  task: string;
}

export function agentDecisionJsonSchema(options: AgentDecisionSchemaOptions) {
  const {
    artifactNames,
    finalResponse,
    requiredLanguage,
    requiresSourceExecution,
    skillNames,
    sourceLineLimit,
    task,
  } = options;
  const response = finalResponseSchema(artifactNames, skillNames);
  if (finalResponse) return response;
  const language = requiredLanguage ?? namedSourceLanguage(task);
  const source = sourceExecutionSchema(language, requiresSourceExecution, skillNames);
  const boundedSource =
    sourceLineLimit === undefined
      ? source
      : {
          ...source,
          properties: {
            ...source.properties,
            source: { ...source.properties.source, maxItems: sourceLineLimit },
          },
        };
  if (requiresSourceExecution) return boundedSource;
  return language === undefined
    ? {
        oneOf: [response, sourceExecutionSchemaBase(skillNames), shellExecutionSchema(skillNames)],
      }
    : { oneOf: [response, source] };
}

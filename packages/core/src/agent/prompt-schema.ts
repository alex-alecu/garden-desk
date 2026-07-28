const FINAL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    action: { const: "respond" },
    response: {
      type: "array",
      items: { type: "string", maxLength: 512 },
      minItems: 1,
      maxItems: 100,
    },
  },
  required: ["action", "response"],
  additionalProperties: false,
} as const;

export const SHELL_COMMAND_CHARACTER_LIMIT = 4_096;

const SOURCE_EXECUTION_SCHEMA = {
  type: "object",
  properties: {
    action: { const: "execute" },
    language: { enum: ["python", "node"] },
    summary: { type: "string", minLength: 1, maxLength: 500 },
    path: { type: "string", minLength: 1, maxLength: 1_000 },
    source: {
      type: "array",
      items: { type: "string", maxLength: 512 },
      minItems: 1,
      maxItems: 250,
    },
  },
  required: ["action", "language", "source", "summary"],
  additionalProperties: false,
} as const;

const SHELL_EXECUTION_SCHEMA = {
  type: "object",
  properties: {
    action: { const: "execute" },
    language: { const: "shell" },
    command: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: SHELL_COMMAND_CHARACTER_LIMIT },
      minItems: 1,
      maxItems: 1,
    },
    summary: { type: "string", minLength: 1, maxLength: 500 },
  },
  required: ["action", "language", "command", "summary"],
  additionalProperties: false,
} as const;

const DECISION_SCHEMA = {
  oneOf: [FINAL_RESPONSE_SCHEMA, SOURCE_EXECUTION_SCHEMA, SHELL_EXECUTION_SCHEMA],
} as const;

export const GENERATION_LIMIT_RECOVERY_SOURCE_LINES = 64;

function namedSourceLanguage(task: string): "python" | "node" | undefined {
  const python = /\bpython\b/iu.test(task);
  const node = /\bnode(?:\.js)?\b/iu.test(task);
  if (python === node) return undefined;
  return python ? "python" : "node";
}

function sourceExecutionSchema(language: "python" | "node" | undefined, boundedSource: boolean) {
  return {
    ...SOURCE_EXECUTION_SCHEMA,
    properties: {
      ...SOURCE_EXECUTION_SCHEMA.properties,
      ...(language === undefined ? {} : { language: { const: language } }),
      source: {
        ...SOURCE_EXECUTION_SCHEMA.properties.source,
        maxItems: boundedSource ? 160 : SOURCE_EXECUTION_SCHEMA.properties.source.maxItems,
      },
    },
  } as const;
}

export function agentDecisionJsonSchema(
  task: string,
  finalResponse: boolean,
  requiresSourceExecution: boolean,
  sourceLineLimit?: number,
) {
  if (finalResponse) return FINAL_RESPONSE_SCHEMA;
  const language = namedSourceLanguage(task);
  const source = sourceExecutionSchema(language, requiresSourceExecution);
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
  return language === undefined ? DECISION_SCHEMA : { oneOf: [FINAL_RESPONSE_SCHEMA, source] };
}

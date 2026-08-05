import type { StructuredGenerationRequest } from "@vault/shared";
import type {
  ChatSessionModelFunctions,
  Llama,
  LlamaChatResponseChunk,
  LlamaChatSession,
  Token,
} from "node-llama-cpp";

class StructuredResult extends Error {
  constructor(readonly value: unknown) {
    super("structured_result");
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function actionFunction(
  schema: Record<string, unknown>,
): [string, ChatSessionModelFunctions[string]] | undefined {
  const properties = record(schema.properties);
  const action = record(properties?.action)?.const;
  if (typeof action !== "string") return undefined;
  const params = {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(properties ?? {}).filter(([name]) => name !== "action"),
    ),
    required: Array.isArray(schema.required)
      ? schema.required.filter((name) => name !== "action")
      : undefined,
  };
  return [
    action,
    {
      description: `Choose ${action} and submit its structured arguments.`,
      params: params as never,
      handler(value: unknown) {
        throw new StructuredResult({ action, ...record(value) });
      },
    },
  ];
}

function structuredFunctions(schema: Record<string, unknown>): ChatSessionModelFunctions {
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : [schema];
  const actionFunctions = alternatives
    .map((alternative) => record(alternative))
    .map((alternative) => (alternative === undefined ? undefined : actionFunction(alternative)));
  if (actionFunctions.every((entry) => entry !== undefined)) {
    return Object.fromEntries(
      actionFunctions as Array<[string, ChatSessionModelFunctions[string]]>,
    );
  }
  return {
    submit_result: {
      description: "Submit the single structured result requested by the user.",
      params: schema as never,
      handler(value: unknown) {
        throw new StructuredResult(value);
      },
    },
  };
}

function plainResponse(schema: Record<string, unknown>, text: string): unknown | undefined {
  const alternatives = Array.isArray(schema.oneOf) ? schema.oneOf : [schema];
  const responseSchema = alternatives
    .map((alternative) => record(alternative))
    .find((alternative) => record(record(alternative?.properties)?.action)?.const === "respond");
  const response = record(record(responseSchema?.properties)?.response);
  const artifacts = record(record(responseSchema?.properties)?.artifacts);
  const items = record(response?.items);
  const value = text.trim();
  if (
    response?.type !== "array" ||
    items?.type !== "string" ||
    value.length === 0 ||
    (artifacts !== undefined && (artifacts.type !== "array" || artifacts.maxItems !== 0))
  ) {
    return undefined;
  }
  const lines = value.split(/\r?\n/u);
  const maxItems =
    typeof response.maxItems === "number" ? response.maxItems : Number.POSITIVE_INFINITY;
  const maxLength =
    typeof items.maxLength === "number" ? items.maxLength : Number.POSITIVE_INFINITY;
  if (lines.length > maxItems || lines.some((line) => line.length > maxLength)) return undefined;
  return {
    action: "respond",
    response: lines,
    ...(artifacts === undefined ? {} : { artifacts: [] }),
  };
}

async function gemmaStructuredValue(
  request: StructuredGenerationRequest,
  session: LlamaChatSession,
  callbacks: StructuredCallbacks,
): Promise<unknown> {
  try {
    const result = await session.promptWithMeta(request.prompt, {
      functions: structuredFunctions(request.jsonSchema),
      maxTokens: request.maxTokens,
      budgets: { thoughtTokens: Math.min(1_024, Math.floor(request.maxTokens / 2)) },
      temperature: 0,
      onResponseChunk: callbacks.onResponseChunk,
      onToken: callbacks.onToken,
    });
    if (result.stopReason === "maxTokens") throw new Error("generation_token_limit");
    const response = plainResponse(request.jsonSchema, result.responseText);
    if (response !== undefined) return response;
    throw new Error("structured_tool_call_required");
  } catch (error) {
    if (error instanceof StructuredResult) return error.value;
    throw error;
  }
}

interface StructuredCallbacks {
  onResponseChunk: (chunk: LlamaChatResponseChunk) => void;
  onToken: (tokens: Token[]) => void;
}

export async function structuredValue(
  request: StructuredGenerationRequest,
  llama: Pick<Llama, "createGrammarForJsonSchema">,
  session: LlamaChatSession,
  callbacks: StructuredCallbacks,
): Promise<unknown> {
  if (request.modelId.startsWith("gemma-4")) {
    return await gemmaStructuredValue(request, session, callbacks);
  }
  const grammar = await llama.createGrammarForJsonSchema(request.jsonSchema as never);
  const result = await session.promptWithMeta(request.prompt, {
    grammar,
    maxTokens: request.maxTokens,
    temperature: 0,
    onResponseChunk: callbacks.onResponseChunk,
    onToken: callbacks.onToken,
  });
  if (result.stopReason === "maxTokens") throw new Error("generation_token_limit");
  return grammar.parse(result.responseText);
}

import type {
  ChatModelFunctions,
  ChatWrapperGenerateContextStateOptions,
  ChatWrapperGeneratedPrefixTriggersContextState,
  Gemma4ChatWrapper,
  LlamaText,
  LlamaTextInputValue,
  LlamaTextValue,
} from "node-llama-cpp";

/** Gemma 4 delimits every string with this one token; the format has no escape sequence. */
export const NATIVE_QUOTE = '<|"|>';
export const NATIVE_CALL_START = "<|tool_call>";
export const NATIVE_CALL_END = "<tool_call|>";

type NativeRuntime = Pick<
  typeof import("node-llama-cpp"),
  "Gemma4ChatWrapper" | "LlamaText" | "SpecialTokensText"
>;
type SpecialText = (text: string) => LlamaTextValue;

function specialText(runtime: NativeRuntime): SpecialText {
  return (text) => new runtime.SpecialTokensText(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joined(items: LlamaTextInputValue[][]): LlamaTextInputValue[] {
  return items.flatMap((item, index) => (index === 0 ? item : [",", ...item]));
}

function nativeObject(value: Record<string, unknown>, special: SpecialText) {
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return [
    "{",
    ...joined(entries.map(([key, item]) => [`${key}:`, ...nativeValue(item, special)])),
    "}",
  ];
}

/**
 * Renders a value the way Gemma 4's own chat template does: bare sorted keys, unquoted
 * numbers and booleans, and strings between two `<|"|>` tokens with their bytes untouched.
 */
function nativeValue(value: unknown, special: SpecialText): LlamaTextInputValue[] {
  if (typeof value === "string") return [special(NATIVE_QUOTE), value, special(NATIVE_QUOTE)];
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (typeof value === "boolean") return [value ? "true" : "false"];
  if (Array.isArray(value)) {
    return ["[", ...joined(value.map((item) => nativeValue(item, special))), "]"];
  }
  if (isRecord(value)) return nativeObject(value, special);
  return ["null"];
}

/** The template writes schema types in upper case and never renders `additionalProperties`. */
function declarationSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(declarationSchema);
  if (!isRecord(schema)) return schema;
  return Object.fromEntries(
    Object.entries(schema).flatMap(([key, value]) => {
      if (key === "additionalProperties") return [];
      if (key === "type" && typeof value === "string") return [[key, value.toUpperCase()]];
      return [[key, declarationSchema(value)]];
    }),
  );
}

function declarations(
  runtime: NativeRuntime,
  availableFunctions: ChatModelFunctions,
  documentParams: boolean,
): LlamaText {
  const special = specialText(runtime);
  return runtime.LlamaText(
    Object.entries(availableFunctions).map(([name, definition]) =>
      runtime.LlamaText([
        special("<|tool>"),
        `declaration:${name}`,
        ...nativeValue(
          {
            description: definition.description ?? "",
            ...(documentParams ? { parameters: declarationSchema(definition.params ?? {}) } : {}),
          },
          special,
        ),
        special("<tool|>"),
      ]),
    ),
  );
}

/**
 * Gemma 4's native tool format, as its chat template renders it: declarations, calls, and
 * results are `name{key:value,...}` objects whose strings sit between two `<|"|>` tokens
 * with no escaping. node-llama-cpp's wrapper writes JSON instead and constrains calls with a
 * JSON grammar, so every quote in generated source had to be escaped in a format the model
 * was not trained on. Function-call detection is disabled here; the worker parses the
 * emitted call from the generated tokens itself (see `gemma-tool-call.ts`).
 */
function vaultGemma4ChatWrapper(runtime: NativeRuntime): typeof Gemma4ChatWrapper {
  const special = specialText(runtime);
  return class VaultGemma4ChatWrapper extends runtime.Gemma4ChatWrapper {
    override readonly wrapperName = "Vault Gemma 4";

    override generateContextState(
      options: ChatWrapperGenerateContextStateOptions,
    ): ChatWrapperGeneratedPrefixTriggersContextState {
      const state = super.generateContextState(options);
      return {
        contextText: state.contextText,
        stopGenerationTriggers: [
          ...state.stopGenerationTriggers,
          runtime.LlamaText(special(NATIVE_CALL_END)),
        ],
        detectFunctionCalls: false,
      };
    }

    override generateAvailableFunctionsSystemText(
      availableFunctions: ChatModelFunctions,
      { documentParams = true }: { documentParams?: boolean },
    ): LlamaText {
      return declarations(runtime, availableFunctions, documentParams);
    }

    override generateFunctionCall(name: string, params: unknown): LlamaText {
      return runtime.LlamaText([
        special(NATIVE_CALL_START),
        `call:${name}`,
        ...nativeValue(params ?? {}, special),
        special(NATIVE_CALL_END),
      ]);
    }

    override generateFunctionCallResult(name: string, _params: unknown, result: unknown) {
      return runtime.LlamaText([
        special("<|tool_response>"),
        `response:${name}`,
        ...nativeValue(isRecord(result) ? result : { value: result ?? null }, special),
        special("<tool_response|>"),
      ]);
    }
  };
}

/** The runtime is imported lazily because the packaged worker resolves it only after start. */
export async function loadVaultGemma4ChatWrapper(): Promise<Gemma4ChatWrapper> {
  const runtime = await import("node-llama-cpp");
  return new (vaultGemma4ChatWrapper(runtime))({ reasoning: true });
}

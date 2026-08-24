import { type ChatGenerationRequest, JobIdSchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { GbnfGrammarGenerator } from "../../node_modules/node-llama-cpp/dist/utils/gbnfJson/GbnfGrammarGenerator.js";
import { getGbnfJsonTerminalForGbnfJsonSchema } from "../../node_modules/node-llama-cpp/dist/utils/gbnfJson/utils/getGbnfJsonTerminalForGbnfJsonSchema.js";
import { chatFunctions, toChatHistory } from "./chat.js";

function functionParamsGrammar(params: unknown): string {
  const generator = new GbnfGrammarGenerator();
  const root = getGbnfJsonTerminalForGbnfJsonSchema(params as never, generator).resolve(
    generator,
    true,
  );
  return generator.generateGbnfFile(root);
}

function grammarRepetitions(grammar: string): number[] {
  return [...grammar.matchAll(/\{(\d+)(?:,(\d+))?\}/gu)].flatMap((match) =>
    match.slice(1).flatMap((value) => (value === undefined ? [] : [Number(value)])),
  );
}

describe("native chat history", () => {
  it("folds tool results into the originating assistant function call", () => {
    const history = toChatHistory([
      { role: "system", text: "System" },
      { role: "user", text: "Inspect" },
      {
        role: "assistant",
        text: "",
        toolCalls: [{ id: "call-1", name: "read", params: { path: "/source/a.txt" } }],
      },
      { role: "tool", toolCallId: "call-1", name: "read", result: "1: value" },
    ]);

    expect(history).toHaveLength(3);
    expect(history[2]).toMatchObject({
      type: "model",
      response: [
        {
          type: "functionCall",
          name: "read",
          params: { path: "/source/a.txt" },
          result: "1: value",
        },
      ],
    });
  });

  it("passes Core tool schemas through without handlers", () => {
    const request = {
      protocolVersion: 2,
      requestId: "test",
      jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      operation: "chat",
      modelId: "test",
      messages: [{ role: "user", text: "List" }],
      tools: [
        {
          name: "list",
          description: "List paths.",
          params: { type: "object", properties: {} },
        },
      ],
      contextSize: 8_192,
      maxTokens: 1_024,
      temperature: 0,
    } satisfies ChatGenerationRequest;
    expect(chatFunctions(request)).toMatchObject({
      list: { description: "List paths.", params: { type: "object", properties: {} } },
    });
  });
});

describe("native tool grammar", () => {
  it("removes native-unsafe string bounds before it builds a function grammar", () => {
    const request = {
      protocolVersion: 2,
      requestId: "test",
      jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      operation: "chat",
      modelId: "test",
      messages: [{ role: "user", text: "List" }],
      tools: [
        {
          name: "list",
          description: "List paths.",
          params: {
            type: "object",
            properties: {
              path: { type: "string", minLength: 1, maxLength: 4_096 },
              depth: { type: "integer", minimum: 0, maximum: 8, default: 2 },
            },
            required: [],
            additionalProperties: false,
          },
        },
      ],
      contextSize: 8_192,
      maxTokens: 1_024,
      temperature: 0,
    } satisfies ChatGenerationRequest;

    const list = chatFunctions(request).list as { params: unknown };
    const grammar = functionParamsGrammar(list.params);

    expect(list.params).toMatchObject({
      properties: { path: { type: "string", minLength: 1 } },
    });
    expect(list.params).not.toHaveProperty("properties.path.maxLength");
    expect(grammar).not.toContain("{1,4096}");
    expect(grammar).toMatch(/string-1-rule ::= .*\+/u);
    expect(grammarRepetitions(grammar).every((count) => count < 2_000)).toBe(true);
  });
});

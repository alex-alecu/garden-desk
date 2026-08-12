import { JobIdSchema, type StructuredGenerationRequest } from "@vault/shared";
import type { ChatSessionModelFunctions, LlamaChatSession, Token } from "node-llama-cpp";
import { describe, expect, it } from "vitest";
import { structuredValue } from "./structured.js";

const request = {
  protocolVersion: 1,
  requestId: "request",
  jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  operation: "generate",
  modelId: "gemma-4-test",
  prompt: "Respond.",
  jsonSchema: {
    type: "object",
    properties: {
      action: { const: "respond" },
      response: { type: "array", items: { type: "string" } },
    },
    required: ["action", "response"],
  },
  contextSize: "auto",
  maxTokens: 16,
} satisfies StructuredGenerationRequest;

describe("structuredValue", () => {
  it("forwards generated function-call tokens to performance timing", async () => {
    let tokenChunks = 0;
    let effectivePrompt = "";
    const session = {
      async promptWithMeta(
        prompt: string,
        options: {
          functions: ChatSessionModelFunctions;
          onToken(tokens: Token[]): void;
        },
      ) {
        effectivePrompt = prompt;
        options.onToken([1 as Token]);
        const action = Object.values(options.functions)[0];
        if (action === undefined) throw new Error("Missing structured action.");
        return await action.handler({ response: ["Done."] } as never);
      },
    } as unknown as LlamaChatSession;

    const value = await structuredValue({
      request,
      llama: {} as never,
      session,
      callbacks: {
        onResponseChunk: () => undefined,
        onToken: () => {
          tokenChunks += 1;
        },
      },
    });

    expect(tokenChunks).toBe(1);
    expect(effectivePrompt).toBe("Respond.");
    expect(value).toEqual({ action: "respond", response: ["Done."] });
  });
});

describe("structuredValue limits", () => {
  it("reports the generation token limit before parsing an incomplete action", async () => {
    const session = {
      async promptWithMeta() {
        return {
          response: [],
          responseText: "",
          stopReason: "maxTokens",
          remainingGenerationAfterStop: undefined,
        };
      },
    } as unknown as LlamaChatSession;

    await expect(
      structuredValue({
        request,
        llama: {} as never,
        session,
        callbacks: {
          onResponseChunk: () => undefined,
          onToken: () => undefined,
        },
      }),
    ).rejects.toThrow("generation_token_limit");
  });
});

describe("structuredValue plain responses", () => {
  it("accepts bounded plain text as a response when Gemma omits the function call", async () => {
    const session = {
      async promptWithMeta() {
        return {
          response: [],
          responseText: "## Result\n\nNo matching transactions were found.",
          stopReason: "eogToken",
          remainingGenerationAfterStop: undefined,
        };
      },
    } as unknown as LlamaChatSession;

    await expect(
      structuredValue({
        request,
        llama: {} as never,
        session,
        callbacks: {
          onResponseChunk: () => undefined,
          onToken: () => undefined,
        },
      }),
    ).resolves.toEqual({
      action: "respond",
      response: ["## Result", "", "No matching transactions were found."],
    });
  });
});

describe("structuredValue empty artifact declarations", () => {
  it("adds the required empty declaration when no deliverable candidates exist", async () => {
    const session = {
      async promptWithMeta() {
        return {
          response: [],
          responseText: "Done.",
          stopReason: "eogToken",
          remainingGenerationAfterStop: undefined,
        };
      },
    } as unknown as LlamaChatSession;
    const emptyArtifactsRequest = {
      ...request,
      jsonSchema: {
        type: "object",
        properties: {
          action: { const: "respond" },
          response: { type: "array", items: { type: "string" } },
          artifacts: { type: "array", maxItems: 0 },
        },
        required: ["action", "response", "artifacts"],
      },
    } satisfies StructuredGenerationRequest;

    await expect(
      structuredValue({
        request: emptyArtifactsRequest,
        llama: {} as never,
        session,
        callbacks: { onResponseChunk: () => undefined, onToken: () => undefined },
      }),
    ).resolves.toEqual({ action: "respond", response: ["Done."], artifacts: [] });
  });
});

describe("structuredValue deliverable declaration boundary", () => {
  it("requires a function call when deliverable candidates must be declared", async () => {
    const session = {
      async promptWithMeta() {
        return {
          response: [],
          responseText: "report.pdf is ready.",
          stopReason: "eogToken",
          remainingGenerationAfterStop: undefined,
        };
      },
    } as unknown as LlamaChatSession;
    const deliverableRequest = {
      ...request,
      jsonSchema: {
        type: "object",
        properties: {
          action: { const: "respond" },
          response: { type: "array", items: { type: "string" } },
          artifacts: {
            type: "array",
            items: { type: "string", enum: ["report.pdf"] },
            maxItems: 1,
          },
        },
        required: ["action", "response", "artifacts"],
      },
    } satisfies StructuredGenerationRequest;

    await expect(
      structuredValue({
        request: deliverableRequest,
        llama: {} as never,
        session,
        callbacks: { onResponseChunk: () => undefined, onToken: () => undefined },
      }),
    ).rejects.toThrow("structured_tool_call_required");
  });
});

describe("structuredValue plain response boundary", () => {
  it("never converts plain text into an execution action", async () => {
    const executeRequest = {
      ...request,
      jsonSchema: {
        type: "object",
        properties: {
          action: { const: "execute" },
          language: { const: "shell" },
          command: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
        required: ["action", "language", "command", "summary"],
      },
    } satisfies StructuredGenerationRequest;
    const session = {
      async promptWithMeta() {
        return {
          response: [],
          responseText: "Run a command.",
          stopReason: "eogToken",
          remainingGenerationAfterStop: undefined,
        };
      },
    } as unknown as LlamaChatSession;

    await expect(
      structuredValue({
        request: executeRequest,
        llama: {} as never,
        session,
        callbacks: { onResponseChunk: () => undefined, onToken: () => undefined },
      }),
    ).rejects.toThrow("structured_tool_call_required");
  });
});

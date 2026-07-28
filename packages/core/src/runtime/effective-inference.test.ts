import { InferenceWorkerRequestSchema, JobIdSchema, MAX_GENERATION_TOKENS } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { generationInput } from "../agent/prompt.js";
import { createGenerationRequest, effectiveGenerationInput } from "./inference.js";

const MAXIMUM_INPUT_PROMPT = "x".repeat(256_000);

describe("M3 effective inference prompts", () => {
  it("constructs the exact Gemma function-call prompt before worker dispatch", () => {
    const input = effectiveGenerationInput({
      modelId: "gemma-4-test",
      prompt: "Respond.",
      jsonSchema: { type: "object" },
      contextSize: 512,
      maxTokens: 8,
    });
    expect(input.prompt).toBe("Respond.\nCall exactly one available function with your answer.");
    expect(effectiveGenerationInput(input)).toBe(input);
  });

  it("keeps a maximum-length Gemma prompt encodable after adding the suffix", () => {
    const request = createGenerationRequest(
      {
        modelId: "gemma-4-test",
        prompt: MAXIMUM_INPUT_PROMPT,
        jsonSchema: { type: "object" },
        contextSize: 512,
        maxTokens: 8,
      },
      { requestId: "test", jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001") },
    );

    expect(request.input.prompt.startsWith(MAXIMUM_INPUT_PROMPT)).toBe(true);
    expect(request.input.prompt).toHaveLength(256_054);
    expect(() =>
      InferenceWorkerRequestSchema.parse({
        protocolVersion: 1,
        requestId: request.identity.requestId,
        jobId: request.identity.jobId,
        operation: "generate",
        ...request.input,
      }),
    ).not.toThrow();
  });

  it("includes the suffix in the agent context-budget calculation", () => {
    const input = generationInput(
      { task: "Reply", modelId: "gemma-4-test" },
      {
        executions: [],
        rejectedDuplicates: 0,
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
      },
    );
    expect(input.prompt).toMatch(/Call exactly one available function with your answer\.$/u);
    expect(Math.ceil(JSON.stringify(input).length / 4)).toBeLessThanOrEqual(4_096);
  });
});

describe("M3 generation request limits", () => {
  it("accepts the 32K generation boundary and rejects larger requests", () => {
    const request = {
      protocolVersion: 1,
      requestId: "test",
      jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001"),
      operation: "generate",
      modelId: "gemma-4-test",
      prompt: "Respond.",
      jsonSchema: { type: "object" },
      contextSize: "auto",
      maxTokens: MAX_GENERATION_TOKENS,
    } as const;

    expect(() => InferenceWorkerRequestSchema.parse(request)).not.toThrow();
    expect(() =>
      InferenceWorkerRequestSchema.parse({ ...request, maxTokens: MAX_GENERATION_TOKENS + 1 }),
    ).toThrow();
  });
});

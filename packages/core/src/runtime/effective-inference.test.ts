import { InferenceWorkerRequestSchema, JobIdSchema, MAX_GENERATION_TOKENS } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { createGenerationRequest, effectiveGenerationInput } from "./inference.js";

const MAXIMUM_INPUT_PROMPT = "x".repeat(256_000);

describe("effective structured inference prompts", () => {
  it("adds the Gemma function-call suffix only to the legacy structured path", () => {
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

  it("keeps a maximum-length structured prompt encodable after adding the suffix", () => {
    const request = createGenerationRequest(
      {
        modelId: "gemma-4-test",
        prompt: MAXIMUM_INPUT_PROMPT,
        jsonSchema: { type: "object" },
        contextSize: 512,
        maxTokens: MAX_GENERATION_TOKENS,
      },
      { requestId: "test", jobId: JobIdSchema.parse("00000000-0000-4000-8000-000000000001") },
    );
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
});

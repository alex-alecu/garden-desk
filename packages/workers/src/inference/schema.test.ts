import { StructuredGenerationRequestSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";

const request = {
  protocolVersion: 2,
  requestId: "00000000-0000-4000-8000-000000000000",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "generate",
  modelId: "qwen3.8-27b-ud-iq4_xs",
  prompt: "Respond.",
  jsonSchema: { type: "object" },
  maxTokens: 1,
} as const;

describe("generation context contract", () => {
  it("accepts automatic context and the 32K product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: "auto" }).success,
    ).toBe(true);
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 32_768 }).success,
    ).toBe(true);
  });

  it("rejects explicit generation context above the product ceiling", () => {
    expect(
      StructuredGenerationRequestSchema.safeParse({ ...request, contextSize: 32_769 }).success,
    ).toBe(false);
  });
});

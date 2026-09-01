import { randomUUID } from "node:crypto";
import type {
  ChatGenerationResult,
  EmbeddingResult,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  StructuredGenerationResult,
} from "@gardendesk/shared";
import { JobIdSchema } from "@gardendesk/shared";
import type {
  ChatInput,
  EmbeddingInput,
  GenerationInput,
  GenerationRequestIdentity,
} from "./inference.js";
import { createGenerationRequest } from "./inference.js";

export function createGenerateWorkerRequest(
  input: GenerationInput,
  identity?: GenerationRequestIdentity,
): InferenceWorkerRequest {
  const request = createGenerationRequest(input, identity);
  return {
    protocolVersion: 2,
    requestId: request.identity.requestId,
    jobId: request.identity.jobId,
    operation: "generate",
    ...request.input,
  };
}

export function createChatWorkerRequest(
  input: ChatInput,
  identity: GenerationRequestIdentity = {
    requestId: randomUUID(),
    jobId: JobIdSchema.parse(randomUUID()),
  },
): InferenceWorkerRequest {
  return {
    protocolVersion: 2,
    requestId: identity.requestId,
    jobId: identity.jobId,
    operation: "chat",
    ...input,
  };
}

export function createEmbedWorkerRequest(input: EmbeddingInput): InferenceWorkerRequest {
  return {
    protocolVersion: 2,
    requestId: randomUUID(),
    jobId: JobIdSchema.parse(randomUUID()),
    operation: "embed",
    ...input,
  };
}

export function expectGenerateResponse(
  response: InferenceWorkerResponse,
): StructuredGenerationResult {
  if (response.status !== "ok" || response.operation !== "generate") {
    throw new Error("unexpected_inference_response");
  }
  return response;
}

export function expectChatResponse(response: InferenceWorkerResponse): ChatGenerationResult {
  if (response.status !== "ok" || response.operation !== "chat") {
    throw new Error("unexpected_inference_response");
  }
  return response;
}

export function expectEmbedResponse(response: InferenceWorkerResponse): EmbeddingResult {
  if (response.status !== "ok" || response.operation !== "embed") {
    throw new Error("unexpected_inference_response");
  }
  return response;
}

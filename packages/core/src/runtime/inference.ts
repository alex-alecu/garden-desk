import { randomUUID } from "node:crypto";
import type {
  EmbeddingRequest,
  EmbeddingResult,
  InferenceProfile,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  JobId,
  ModelRuntimeStatus,
  RequestId,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from "@vault/shared";
import { JobIdSchema } from "@vault/shared";

export type GenerationInput = Omit<
  StructuredGenerationRequest,
  "protocolVersion" | "requestId" | "jobId" | "operation"
>;
export type EmbeddingInput = Omit<
  EmbeddingRequest,
  "protocolVersion" | "requestId" | "jobId" | "operation"
>;

export interface GenerationRequestIdentity {
  requestId: RequestId;
  jobId: JobId;
}

export const GEMMA_FUNCTION_CALL_SUFFIX = "\nCall exactly one available function with your answer.";

export function effectiveGenerationInput(input: GenerationInput): GenerationInput {
  if (!input.modelId.startsWith("gemma-4") || input.prompt.endsWith(GEMMA_FUNCTION_CALL_SUFFIX)) {
    return input;
  }
  return { ...input, prompt: `${input.prompt}${GEMMA_FUNCTION_CALL_SUFFIX}` };
}

export function createGenerationRequest(
  input: GenerationInput,
  identity?: GenerationRequestIdentity,
): {
  input: GenerationInput;
  identity: GenerationRequestIdentity;
} {
  return {
    input: effectiveGenerationInput(input),
    identity: identity ?? { requestId: randomUUID(), jobId: JobIdSchema.parse(randomUUID()) },
  };
}

export interface InferenceExecution {
  request: InferenceWorkerRequest;
  modelPath?: string;
  memoryBudgetBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  onThinkingDelta?(text: string): void;
}

export interface InferencePort {
  execute(execution: InferenceExecution): Promise<InferenceWorkerResponse>;
  unload(): Promise<boolean>;
}

export interface InferenceService {
  generate(
    input: GenerationInput,
    signal?: AbortSignal,
    onThinkingDelta?: (text: string) => void,
    identity?: GenerationRequestIdentity,
  ): Promise<StructuredGenerationResult>;
  embed(input: EmbeddingInput, signal?: AbortSignal): Promise<EmbeddingResult>;
  modelStatus(): Promise<ModelRuntimeStatus>;
  unloadModel(): Promise<boolean>;
}

export interface InferenceConfiguration {
  profile: InferenceProfile;
  modelStoreDir: string;
}

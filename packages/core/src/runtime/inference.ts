import { randomUUID } from "node:crypto";
import type {
  ChatGenerationRequest,
  ChatGenerationResult,
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
} from "@gardendesk/shared";
import { JobIdSchema } from "@gardendesk/shared";
import { gemmaFunctionCallSuffix } from "./prompt-instructions.js";

export type GenerationInput = Omit<
  StructuredGenerationRequest,
  "protocolVersion" | "requestId" | "jobId" | "operation"
>;
export type ChatInput = Omit<
  ChatGenerationRequest,
  "protocolVersion" | "requestId" | "jobId" | "operation"
>;
export type EmbeddingInput = Omit<
  EmbeddingRequest,
  "protocolVersion" | "requestId" | "jobId" | "operation"
>;

export interface GenerationRequestIdentity {
  requestId: RequestId;
  jobId: JobId;
  priority?: "primary" | "secondary";
}

export function effectiveGenerationInput(input: GenerationInput): GenerationInput {
  if (!input.modelId.startsWith("gemma-4")) {
    return input;
  }
  const suffix = gemmaFunctionCallSuffix();
  if (input.prompt.endsWith(suffix)) return input;
  return { ...input, prompt: `${input.prompt}${suffix}` };
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
  onResponseDelta?(text: string): void;
}

export interface InferencePort {
  execute(execution: InferenceExecution): Promise<InferenceWorkerResponse>;
  unload(): Promise<boolean>;
}

export interface ImageInspectionInput {
  imagePath: string;
  modelId: string;
  projectorModelId: string;
  prompt: string;
}

export interface ImageInferenceExecution {
  imagePath: string;
  memoryBudgetBytes: number;
  modelPath: string;
  projectorPath: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export interface ImageInferencePort {
  inspect(execution: ImageInferenceExecution): Promise<{ text: string }>;
}

export interface InferenceStreamCallbacks {
  onThinkingDelta?(text: string): void;
  onResponseDelta?(text: string): void;
}

export interface InferenceService {
  generate(
    input: GenerationInput,
    signal?: AbortSignal,
    onThinkingDelta?: (text: string) => void,
    identity?: GenerationRequestIdentity,
  ): Promise<StructuredGenerationResult>;
  chat(
    input: ChatInput,
    signal?: AbortSignal,
    streams?: InferenceStreamCallbacks,
    identity?: GenerationRequestIdentity,
  ): Promise<ChatGenerationResult>;
  embed(input: EmbeddingInput, signal?: AbortSignal): Promise<EmbeddingResult>;
  inspectImage(input: ImageInspectionInput, signal?: AbortSignal): Promise<string>;
  modelStatus(): Promise<ModelRuntimeStatus>;
  unloadModel(): Promise<boolean>;
}

export interface InferenceConfiguration {
  profile: InferenceProfile;
  modelStoreDir: string;
}

import type { InferenceWorkerRequest } from "@gardendesk/shared";

const MINIMUM_INFERENCE_TIMEOUT_MS = 300_000;
const GENERATION_TOKEN_TIMEOUT_MS = 60;

export interface ActiveInferenceExecution {
  lifecycle: AbortController;
  signal: AbortSignal;
  startedAt: number;
  timeoutMs: number;
  finish(): void;
}

export function inferenceTimeoutMs(request: InferenceWorkerRequest): number {
  return request.operation === "generate" || request.operation === "chat"
    ? Math.max(MINIMUM_INFERENCE_TIMEOUT_MS, request.maxTokens * GENERATION_TOKEN_TIMEOUT_MS)
    : MINIMUM_INFERENCE_TIMEOUT_MS;
}

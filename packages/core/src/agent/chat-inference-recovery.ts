import { inferenceFailureCode } from "../runtime/inference-errors.js";

const RETRYABLE_FAILURES = new Set(["internal", "worker_crash", "malformed_worker_message"]);

export function canRetryInference(
  error: unknown,
  retryUsed: boolean,
  signal?: AbortSignal,
): boolean {
  return (
    !retryUsed && signal?.aborted !== true && RETRYABLE_FAILURES.has(inferenceFailureCode(error))
  );
}

export async function generateWithInferenceRecovery<T>(options: {
  generate(): Promise<T>;
  recover(): Promise<void>;
  recovery: { inferenceRetryUsed: boolean };
  signal?: AbortSignal;
  onRetry?(): void;
}): Promise<T> {
  try {
    return await options.generate();
  } catch (error) {
    if (!canRetryInference(error, options.recovery.inferenceRetryUsed, options.signal)) throw error;
    options.recovery.inferenceRetryUsed = true;
    options.onRetry?.();
    await options.recover();
    return await options.generate();
  }
}

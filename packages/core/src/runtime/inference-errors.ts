import type { ErrorCode } from "@vault/shared";
import { ErrorCodeSchema } from "@vault/shared";

export class InferenceFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function inferenceFailureCode(error: unknown): string {
  if (error instanceof InferenceFailure) return error.code;
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (!(error instanceof Error)) return "internal";
  const typedCode = ErrorCodeSchema.safeParse("code" in error ? error.code : undefined);
  if (typedCode.success) return typedCode.data;
  if (error.message === "missing_model") return "not_found";
  if (error.message.includes("memory")) return "out_of_memory";
  return "internal";
}

export function inferenceFailurePreservesResident(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted && error instanceof InferenceFailure && error.code === "cancelled")
    return true;
  return (
    error instanceof Error &&
    ["structured_tool_call_required", "generation_token_limit"].includes(error.message)
  );
}

export function inferenceAbortFailure(signal: AbortSignal): InferenceFailure {
  const code =
    signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
      ? "timeout"
      : "cancelled";
  return new InferenceFailure(
    code,
    code === "timeout" ? "Inference timed out." : "Inference cancelled.",
  );
}

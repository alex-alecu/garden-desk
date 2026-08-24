import type { ErrorCode, InferenceWorkerResponse } from "@vault/shared";

type InferenceFailure = Extract<InferenceWorkerResponse, { status: "error" }>["error"];

function errorText(error: unknown): string {
  try {
    const text = error instanceof Error ? error.message : "";
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

function failureCode(error: unknown): ErrorCode {
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
  if (error instanceof DOMException && error.name === "TimeoutError") return "timeout";
  const text = errorText(error);
  if (unsupported(text)) return "unsupported";
  return /memory|allocation|out of memory/iu.test(text) ? "out_of_memory" : "internal";
}

function unsupported(text: string): boolean {
  return [
    "supported_gpu_required",
    "selected_gpu_backend_required",
    "selected_gpu_changed",
    "selected_gpu_isolation_failed",
    "context_size_exceeds_hardware_cap",
  ].includes(text);
}

export function inferenceFailureResponse(error: unknown): InferenceFailure {
  const code = failureCode(error);
  const text = errorText(error);
  return {
    code,
    message: code === "unsupported" && unsupported(text) ? text : "Inference failed.",
  };
}

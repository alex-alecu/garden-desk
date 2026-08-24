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

function interruptionCode(error: unknown): "cancelled" | "timeout" | undefined {
  try {
    if (!(error instanceof DOMException)) return undefined;
    if (error.name === "AbortError") return "cancelled";
    if (error.name === "TimeoutError") return "timeout";
  } catch {
    return undefined;
  }
  return undefined;
}

function failureCode(error: unknown): ErrorCode {
  const interruption = interruptionCode(error);
  if (interruption !== undefined) return interruption;
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
  return { code: failureCode(error), message: "Inference failed." };
}

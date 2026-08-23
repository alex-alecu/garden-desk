import type {
  InferenceWorkerFrame,
  InferenceWorkerMessage,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  RequestId,
} from "@vault/shared";
import {
  encodeInferenceMessage,
  encodeInferenceResponse,
  InferenceRequestDecoder,
} from "./frames.js";
import { probe } from "./probe.js";
import { inferenceFailureResponse } from "./worker-errors.js";
import { chat, embed, generate } from "./worker-operations.js";
import { runtime } from "./worker-runtime.js";

function failure(requestId: RequestId, error: unknown): InferenceWorkerResponse {
  return {
    protocolVersion: 2,
    requestId,
    status: "error",
    error: inferenceFailureResponse(error),
  };
}

async function infer(
  request: InferenceWorkerRequest,
  emit: (message: InferenceWorkerMessage) => void,
  signal: AbortSignal,
): Promise<InferenceWorkerResponse> {
  if (request.operation === "probe") return probe(request);
  const loaded = await runtime(request.operation === "embed" ? "embed" : "generate");
  // Manual unload terminates the worker so the OS safely reclaims all native resources.
  if (request.operation === "embed") return await embed(request, loaded);
  if (request.operation === "chat") return await chat(request, loaded, emit, signal);
  return await generate(request, loaded, emit, signal);
}

let requestId: RequestId = "00000000-0000-4000-8000-000000000000";
const decoder = new InferenceRequestDecoder();
const emit = (message: InferenceWorkerMessage) =>
  process.stdout.write(encodeInferenceMessage(message));

/**
 * Dispatches each request concurrently so multiple chat turns can generate in parallel over the
 * model's context sequences. Responses carry their own request ID, so the host client routes them
 * back to the correct caller regardless of completion order. The number of in-flight requests is
 * bounded by the host supervisor's sequence-slot limiter.
 */
const inFlight = new Set<Promise<void>>();
const controllers = new Map<RequestId, AbortController>();

function dispatch(request: InferenceWorkerRequest): void {
  const controller = new AbortController();
  controllers.set(request.requestId, controller);
  const task = (async () => {
    try {
      process.stdout.write(encodeInferenceResponse(await infer(request, emit, controller.signal)));
    } catch (error) {
      process.stdout.write(encodeInferenceResponse(failure(request.requestId, error)));
    }
  })();
  inFlight.add(task);
  void task.finally(() => {
    inFlight.delete(task);
    controllers.delete(request.requestId);
  });
}

function cancel(frame: Extract<InferenceWorkerFrame, { operation: "cancel" }>): void {
  const controller = controllers.get(frame.requestId);
  if (controller === undefined) return;
  const reason =
    frame.code === "timeout"
      ? new DOMException("Inference timed out.", "TimeoutError")
      : new DOMException("Inference cancelled.", "AbortError");
  controller.abort(reason);
}

try {
  for await (const chunk of process.stdin) {
    for (const frame of decoder.push(Buffer.from(chunk))) {
      requestId = frame.requestId;
      if (frame.operation === "cancel") cancel(frame);
      else dispatch(frame);
    }
  }
  await Promise.allSettled([...inFlight]);
  decoder.finish();
} catch (error) {
  process.stdout.write(encodeInferenceResponse(failure(requestId, error)));
}

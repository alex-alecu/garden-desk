import type {
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
import { chat, embed, generate } from "./worker-operations.js";
import { runtime } from "./worker-runtime.js";

function failure(requestId: RequestId, error: unknown): InferenceWorkerResponse {
  const text = error instanceof Error ? error.message : String(error);
  const code =
    text === "supported_gpu_required" ||
    text === "dedicated_gpu_vram_required" ||
    text === "context_size_exceeds_hardware_cap"
      ? "unsupported"
      : /memory|allocation|out of memory/iu.test(text)
        ? "out_of_memory"
        : "internal";
  return {
    protocolVersion: 1,
    requestId,
    status: "error",
    error: { code, message: text },
  };
}

async function infer(
  request: InferenceWorkerRequest,
  emit: (message: InferenceWorkerMessage) => void,
): Promise<InferenceWorkerResponse> {
  if (request.operation === "probe") return probe(request);
  const loaded = await runtime(request.operation === "embed" ? "embed" : "generate");
  // Manual unload terminates the worker so the OS safely reclaims all native resources.
  if (request.operation === "embed") return await embed(request, loaded);
  if (request.operation === "chat") return await chat(request, loaded, emit);
  return await generate(request, loaded, emit);
}

let requestId: RequestId = "00000000-0000-4000-8000-000000000000";
const decoder = new InferenceRequestDecoder();
const emit = (message: InferenceWorkerMessage) =>
  process.stdout.write(encodeInferenceMessage(message));
try {
  for await (const chunk of process.stdin) {
    for (const request of decoder.push(Buffer.from(chunk))) {
      requestId = request.requestId;
      try {
        process.stdout.write(encodeInferenceResponse(await infer(request, emit)));
      } catch (error) {
        process.stdout.write(encodeInferenceResponse(failure(requestId, error)));
      }
    }
  }
  decoder.finish();
} catch (error) {
  process.stdout.write(encodeInferenceResponse(failure(requestId, error)));
}

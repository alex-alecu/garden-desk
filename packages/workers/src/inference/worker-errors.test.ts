import { describe, expect, it } from "vitest";
import { encodeInferenceResponse, InferenceResponseDecoder } from "./frames.js";
import { InferenceWorkerError } from "./resident-worker.js";
import { inferenceFailureResponse } from "./worker-errors.js";

const privateData =
  'private-worker-stderr-sentinel stderr=/private/worker.log args={"path":"/private/input"} modelOutput=secret stack=private';

describe("inference worker failures", () => {
  it("returns a fixed private error response", () => {
    const response = inferenceFailureResponse(
      new InferenceWorkerError("worker_crash", privateData),
    );
    const frame = encodeInferenceResponse({
      protocolVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      status: "error",
      error: response,
    });
    const [decoded] = new InferenceResponseDecoder().push(frame);

    expect(response).toEqual({ code: "internal", message: "Inference failed." });
    expect(decoded).toEqual({
      protocolVersion: 2,
      requestId: "00000000-0000-4000-8000-000000000001",
      status: "error",
      error: response,
    });
    expect(JSON.stringify(decoded)).not.toContain(privateData);
    expect(response).not.toHaveProperty("details");
  });

  it("keeps the checkpoint worker error codes", () => {
    expect(inferenceFailureResponse(new DOMException("stop", "AbortError")).code).toBe("cancelled");
    expect(inferenceFailureResponse(new DOMException("timeout", "TimeoutError")).code).toBe(
      "timeout",
    );
    expect(inferenceFailureResponse(new Error("supported_gpu_required")).code).toBe("unsupported");
    expect(inferenceFailureResponse(new Error("memory allocation failed")).code).toBe(
      "out_of_memory",
    );
  });

  it("keeps an allowlisted unsupported reason for the caller", () => {
    expect(inferenceFailureResponse(new Error("context_size_exceeds_hardware_cap"))).toEqual({
      code: "unsupported",
      message: "context_size_exceeds_hardware_cap",
    });
    expect(inferenceFailureResponse(new Error(`out of memory ${privateData}`))).toEqual({
      code: "out_of_memory",
      message: "Inference failed.",
    });
  });
});

import type { RequestId } from "@gardendesk/shared";
import {
  writeDevelopmentWorkerFailure,
  writeDevelopmentWorkerStderrReady,
} from "./development-diagnostics.js";
import { encodeInferenceResponse, InferenceRequestDecoder } from "./frames.js";
import { probe } from "./probe.js";
import { inferenceFailureResponse } from "./worker-errors.js";

writeDevelopmentWorkerStderrReady();
const decoder = new InferenceRequestDecoder();
let requestId: RequestId = "00000000-0000-4000-8000-000000000000";
try {
  for await (const chunk of process.stdin) {
    for (const request of decoder.push(Buffer.from(chunk))) {
      requestId = request.requestId;
      if (request.operation !== "probe") throw new Error("unsupported_probe_operation");
      process.stdout.write(encodeInferenceResponse(await probe(request)));
    }
  }
  decoder.finish();
} catch (error) {
  writeDevelopmentWorkerFailure(error);
  process.stdout.write(
    encodeInferenceResponse({
      protocolVersion: 2,
      requestId,
      status: "error",
      error: inferenceFailureResponse(error),
    }),
  );
}

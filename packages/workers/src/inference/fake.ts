import type { InferenceWorkerRequest, InferenceWorkerResponse } from "@vault/shared";

function memoryReport(request: { contextSize: number | "auto" }, budgetBytes: number) {
  return {
    cpuRamBytes: 1024,
    gpuVramBytes: 2048,
    budgetBytes,
    detectedGpuVramBytes: budgetBytes,
    contextSizeTokens: request.contextSize === "auto" ? 65_536 : request.contextSize,
  };
}

export class FakeInferenceWorker {
  async unload(): Promise<boolean> {
    return true;
  }

  async execute(input: {
    request: InferenceWorkerRequest;
    memoryBudgetBytes: number;
  }): Promise<InferenceWorkerResponse> {
    const { request, memoryBudgetBytes } = input;
    if (request.operation === "probe") {
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        operation: "probe",
        networkDenied: true,
        credentialEnvironmentAbsent: true,
        shellEnvironmentAbsent: true,
        workspaceDenied: true,
        outOfScopeReadDenied: true,
        outOfScopeWriteDenied: true,
        executableToolsDenied: true,
        nodeReexecDenied: true,
      };
    }
    const memory = memoryReport(request, memoryBudgetBytes);
    if (request.operation === "embed") {
      return {
        protocolVersion: 1,
        requestId: request.requestId,
        status: "ok",
        operation: "embed",
        vector: [request.input.length, 1],
        memory,
      };
    }
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      status: "ok",
      operation: "generate",
      value: { result: request.prompt },
      memory,
      performance: {
        promptTokens: 2,
        outputTokens: 1,
        promptDurationMs: 2,
        generationDurationMs: 1,
        totalDurationMs: 3,
      },
    };
  }
}

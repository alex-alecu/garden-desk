import type { InferenceWorkerRequest, InferenceWorkerResponse } from "@vault/shared";

function memoryReport(request: { contextSize: number | "auto" }, budgetBytes: number) {
  return {
    cpuRamBytes: 1024,
    gpuMemoryBytes: 2048,
    budgetBytes,
    detectedGpuMemoryBytes: budgetBytes,
    gpuMemoryKind: "unified" as const,
    backend: "metal" as const,
    selectedDeviceCount: 1 as const,
    contextSizeTokens: request.contextSize === "auto" ? 65_536 : request.contextSize,
    contextLimitTokens: 65_536,
    contextLimitReason: "certified_standard" as const,
  };
}

function probeResponse(request: InferenceWorkerRequest): InferenceWorkerResponse {
  return {
    protocolVersion: 2,
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

function embedResponse(
  request: Extract<InferenceWorkerRequest, { operation: "embed" }>,
  memoryBudgetBytes: number,
): InferenceWorkerResponse {
  return {
    protocolVersion: 2,
    requestId: request.requestId,
    status: "ok",
    operation: "embed",
    vector: [request.input.length, 1],
    memory: memoryReport(request, memoryBudgetBytes),
  };
}

function fakePerformance() {
  return {
    promptTokens: 2,
    outputTokens: 1,
    promptDurationMs: 2,
    generationDurationMs: 1,
    totalDurationMs: 3,
  };
}

function chatResponse(
  request: Extract<InferenceWorkerRequest, { operation: "chat" }>,
  memoryBudgetBytes: number,
): InferenceWorkerResponse {
  return {
    protocolVersion: 2,
    requestId: request.requestId,
    status: "ok",
    operation: "chat",
    text: "",
    toolCalls: [],
    stopReason: "text",
    contextUsedTokens: 2,
    memory: memoryReport(request, memoryBudgetBytes),
    performance: fakePerformance(),
  };
}

function generateResponse(
  request: Exclude<InferenceWorkerRequest, { operation: "probe" | "embed" | "chat" }>,
  memoryBudgetBytes: number,
): InferenceWorkerResponse {
  return {
    protocolVersion: 2,
    requestId: request.requestId,
    status: "ok",
    operation: "generate",
    value: { result: request.prompt },
    memory: memoryReport(request, memoryBudgetBytes),
    performance: fakePerformance(),
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
    switch (request.operation) {
      case "probe":
        return probeResponse(request);
      case "embed":
        return embedResponse(request, memoryBudgetBytes);
      case "chat":
        return chatResponse(request, memoryBudgetBytes);
      case "generate":
        return generateResponse(request, memoryBudgetBytes);
    }
  }
}

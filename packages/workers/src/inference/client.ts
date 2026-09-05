import { setTimeout as delay } from "node:timers/promises";
import {
  INFERENCE_PROFILE,
  type InferenceWorkerRequest,
  type InferenceWorkerResponse,
  InferenceWorkerResponseSchema,
} from "@gardendesk/shared";
import {
  type NativeWorkerHandle,
  NativeWorkerLaunchError,
  type NativeWorkerLauncher,
} from "../native/launcher.js";
import { recordDevelopmentHostFailure } from "./development-diagnostics.js";
import { waitForDevelopmentHostRecord } from "./development-host-record-wait.js";
import {
  type InferenceExecution,
  InferenceWorkerError,
  ResidentWorker,
} from "./resident-worker.js";
import { chatBody, completeChat } from "./server-chat.js";
import { ServerError, serverRequest } from "./server-http.js";
import { startServer } from "./server-runtime.js";

export { type InferenceExecution, InferenceWorkerError } from "./resident-worker.js";

type ModelRequest = Exclude<InferenceWorkerRequest, { operation: "probe" }>;
function boundedFailure(error: unknown): Error {
  if (
    error instanceof InferenceWorkerError ||
    error instanceof ServerError ||
    error instanceof NativeWorkerLaunchError
  )
    return error;
  if (error instanceof Error && error.message === "generation_token_limit") return error;
  return new ServerError("malformed_worker_message");
}
interface ResidentServer {
  handle: NativeWorkerHandle;
  modelPath: string;
  contextTokens: number;
  embedding: boolean;
}

function interruption(signal: AbortSignal): InferenceWorkerError {
  const reason = signal.reason;
  const timeout =
    reason instanceof Error &&
    (reason.name === "TimeoutError" || ("code" in reason && reason.code === "timeout"));
  return new InferenceWorkerError(
    timeout ? "timeout" : "cancelled",
    timeout ? "Inference timed out." : "Inference cancelled.",
  );
}

async function embedding(handle: NativeWorkerHandle, input: string, signal: AbortSignal) {
  const value = (await serverRequest(
    handle,
    "/v1/embeddings",
    { input, encoding_format: "float", truncate: false },
    { signal },
  )) as { data: Array<{ embedding: number[] }> };
  const vector = value.data[0]?.embedding;
  if (!Array.isArray(vector) || vector.some((x) => !Number.isFinite(x)))
    throw new ServerError("malformed_worker_message");
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) throw new ServerError("malformed_worker_message");
  return vector.map((x) => x / norm);
}

export class InferenceWorkerClient {
  private resident: ResidentServer | undefined;
  private busy = false;
  constructor(
    private readonly launcher: NativeWorkerLauncher,
    private readonly workerEntryPath: string,
  ) {}

  async unload(): Promise<boolean> {
    if (this.busy) return false;
    return await this.dropResident();
  }

  private async dropResident(): Promise<boolean> {
    const resident = this.resident;
    this.resident = undefined;
    if (resident === undefined) return false;
    await resident.handle.dispose();
    return true;
  }

  async execute(execution: InferenceExecution): Promise<InferenceWorkerResponse> {
    const signal = AbortSignal.any([
      AbortSignal.timeout(execution.timeoutMs),
      ...(execution.signal === undefined ? [] : [execution.signal]),
    ]);
    if (signal.aborted) throw interruption(signal);
    const request = execution.request;
    if (request.operation === "probe") return await this.probe(execution, signal);
    if (this.busy) throw new InferenceWorkerError("worker_crash", "Inference worker is busy.");
    this.busy = true;
    try {
      const resident = await this.prepare(execution, request, signal);
      return await this.complete(execution, request, resident, signal);
    } catch (error) {
      if (signal.aborted) {
        await this.cancel();
        throw interruption(signal);
      }
      await this.dropResident();
      throw boundedFailure(error);
    } finally {
      this.busy = false;
    }
  }

  private async probe(execution: InferenceExecution, signal: AbortSignal) {
    const handle = await this.launcher.launch({
      workerEntryPath: this.workerEntryPath,
      memoryBudgetBytes: execution.memoryBudgetBytes,
    });
    const worker = new ResidentWorker(handle, undefined, execution.memoryBudgetBytes, () => {});
    try {
      if (signal.aborted) throw interruption(signal);
      return await worker.execute({ ...execution, signal });
    } finally {
      await worker.dispose();
    }
  }

  private async prepare(
    execution: InferenceExecution,
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<ResidentServer> {
    const modelPath = execution.modelPath;
    if (modelPath === undefined) throw new ServerError("invalid_argument");
    const contextTokens =
      request.contextSize === "auto" ? INFERENCE_PROFILE.contextTokens : request.contextSize;
    const embedding = request.operation === "embed";
    if (
      this.resident &&
      (this.resident.modelPath !== modelPath ||
        this.resident.contextTokens !== contextTokens ||
        this.resident.embedding !== embedding)
    )
      await this.dropResident();
    if (this.resident) return this.resident;
    const handle = await startServer(
      this.launcher,
      this.workerEntryPath,
      { modelPath, contextTokens, embedding, memoryBudgetBytes: execution.memoryBudgetBytes },
      signal,
    ).catch(async (error: unknown) => {
      if (
        signal.aborted ||
        error instanceof ServerError ||
        error instanceof NativeWorkerLaunchError
      )
        throw error;
      if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ === true)
        await waitForDevelopmentHostRecord(
          recordDevelopmentHostFailure("worker_launch", request.operation, error),
        );
      throw new InferenceWorkerError("worker_crash", "Inference worker stopped.");
    });
    this.resident = { handle, modelPath, contextTokens, embedding };
    return this.resident;
  }

  private memory(contextTokens: number, budgetBytes: number) {
    const gpu = this.launcher.gpu;
    return {
      budgetBytes,
      backend: gpu?.backend ?? "metal",
      gpuMemoryKind: gpu?.memoryKind ?? "unified",
      selectedDeviceCount: 1,
      ...(gpu?.detectedMemoryBytes === undefined
        ? {}
        : { detectedGpuMemoryBytes: gpu.detectedMemoryBytes }),
      contextSizeTokens: contextTokens,
      contextLimitTokens: INFERENCE_PROFILE.contextTokens,
      contextLimitReason: "certified_standard",
      sequenceCount: 1,
    };
  }

  private async complete(
    execution: InferenceExecution,
    request: ModelRequest,
    resident: ResidentServer,
    signal: AbortSignal,
  ) {
    const { handle, contextTokens } = resident;
    const base = {
      protocolVersion: 2,
      requestId: request.requestId,
      status: "ok",
      operation: request.operation,
      memory: this.memory(contextTokens, execution.memoryBudgetBytes),
    };
    if (request.operation === "embed")
      return InferenceWorkerResponseSchema.parse({
        ...base,
        vector: await embedding(handle, request.input, signal),
      });
    const result = await completeChat(handle, chatBody(request, execution), signal, execution);
    if (request.operation === "chat")
      return InferenceWorkerResponseSchema.parse({ ...base, ...result });
    if (result.stopReason === "maxTokens") throw new Error("generation_token_limit");
    return InferenceWorkerResponseSchema.parse({
      ...base,
      value: JSON.parse(result.text),
      performance: result.performance,
    });
  }

  private async cancel(): Promise<void> {
    if (this.resident === undefined) return;
    const handle = this.resident.handle;
    const signal = AbortSignal.timeout(1_000);
    try {
      while (
        (
          (await serverRequest(handle, "/slots", undefined, { signal })) as Array<{
            is_processing: boolean;
          }>
        ).some((slot) => slot.is_processing)
      )
        await delay(25, undefined, { signal });
    } catch {
      await this.dropResident();
    }
  }
}

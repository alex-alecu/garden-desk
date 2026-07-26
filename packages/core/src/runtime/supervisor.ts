import { randomUUID } from "node:crypto";
import type {
  AuditEventInput,
  EmbeddingResult,
  InferenceOperation,
  InferenceWorkerRequest,
  StructuredGenerationResult,
} from "@vault/shared";
import { JobIdSchema } from "@vault/shared";
import type {
  EmbeddingInput,
  GenerationInput,
  GenerationRequestIdentity,
  InferencePort,
  InferenceService,
} from "./inference.js";
import { createGenerationRequest } from "./inference.js";
import { recordInferenceAudit } from "./inference-audit.js";
import {
  InferenceFailure,
  inferenceAbortFailure,
  inferenceFailureCode,
} from "./inference-errors.js";
import { DEFAULT_MODEL_ID, modelRuntimeStatus } from "./model-status.js";
import type { ModelResolver } from "./models.js";
import type { ResourceScheduler } from "./scheduler.js";
import { AsyncSerial } from "./serial.js";

type AuditAppender = (event: AuditEventInput) => void;
type ResourceLease = ReturnType<ResourceScheduler["reserve"]>;
type StagedModel = Awaited<ReturnType<ModelResolver["resolve"]>>;
const INFERENCE_TIMEOUT_MS = 300_000;
interface ActiveExecution {
  lifecycle: AbortController;
  signal: AbortSignal;
  startedAt: number;
  finish(): void;
}

export class InferenceSupervisor implements InferenceService {
  private readonly active = new Map<AbortController, Promise<void>>();
  private readonly serial = new AsyncSerial();
  private measurements: Parameters<typeof modelRuntimeStatus>[2] = {};
  private resident:
    | {
        modelId: string;
        operation: InferenceOperation;
        stagedModel: StagedModel;
        lease: ResourceLease;
      }
    | undefined;
  private closed = false;

  constructor(
    private readonly port: InferencePort,
    private readonly models: ModelResolver,
    private readonly scheduler: ResourceScheduler,
    private readonly audit: AuditAppender,
  ) {}

  private startExecution(signal?: AbortSignal): ActiveExecution {
    if (this.closed) throw new InferenceFailure("cancelled", "Inference supervisor closed.");
    const lifecycle = new AbortController();
    const operationSignal = AbortSignal.any([
      lifecycle.signal,
      ...(signal === undefined ? [] : [signal]),
    ]);
    let finishExecution!: () => void;
    const finished = new Promise<void>((accept) => {
      finishExecution = () => accept();
    });
    this.active.set(lifecycle, finished);
    return { lifecycle, signal: operationSignal, startedAt: 0, finish: finishExecution };
  }

  private startTimedExecution(execution: ActiveExecution): void {
    execution.signal.throwIfAborted();
    execution.signal = AbortSignal.any([
      execution.signal,
      AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    ]);
    execution.startedAt = Date.now();
  }

  private async execute(
    request: InferenceWorkerRequest,
    execution: ActiveExecution,
    lease: ResourceLease,
    options: {
      stagedModel?: StagedModel;
      onThinkingDelta?: (text: string) => void;
    },
  ) {
    const response = await this.port.execute({
      request,
      ...(options.stagedModel === undefined ? {} : { modelPath: options.stagedModel.path }),
      memoryBudgetBytes: lease.memoryBudgetBytes,
      timeoutMs: Math.max(1, INFERENCE_TIMEOUT_MS - (Date.now() - execution.startedAt)),
      signal: execution.signal,
      ...(options.onThinkingDelta === undefined
        ? {}
        : { onThinkingDelta: options.onThinkingDelta }),
    });
    if (response.status === "error") {
      throw new InferenceFailure(response.error.code, response.error.message);
    }
    if (response.operation !== request.operation) {
      throw new InferenceFailure(
        "malformed_worker_message",
        "Inference response operation mismatch.",
      );
    }
    if (response.operation === "generate") {
      this.measurements = {
        memoryBudgetBytes: response.memory.budgetBytes,
        cpuRamBytes: response.memory.cpuRamBytes,
        gpuVramBytes: response.memory.gpuVramBytes,
        ...(response.memory.contextSizeTokens === undefined
          ? {}
          : { contextSizeTokens: response.memory.contextSizeTokens }),
      };
    }
    recordInferenceAudit(this.audit, {
      operation: request.operation,
      requestId: request.requestId,
      jobId: request.jobId,
      outcome: "succeeded",
    });
    return response;
  }

  private finishExecution(execution: ActiveExecution): void {
    this.active.delete(execution.lifecycle);
    execution.finish();
  }

  private async prepareModel(modelId: string, operation: InferenceOperation, signal: AbortSignal) {
    if (this.resident?.modelId === modelId && this.resident.operation === operation) {
      return this.resident;
    }
    if (this.resident !== undefined) await this.releaseResident();
    const lease = this.scheduler.reserve(operation);
    try {
      const stagedModel = await this.models.resolve(modelId, signal);
      this.resident = { modelId, operation, stagedModel, lease };
      return this.resident;
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  private async releaseResident(): Promise<boolean> {
    const resident = this.resident;
    this.resident = undefined;
    this.measurements = {};
    const unloaded = await this.port.unload();
    if (resident === undefined) return unloaded;
    try {
      await resident.stagedModel.dispose();
    } finally {
      resident.lease.release();
    }
    return true;
  }

  private async resources(request: InferenceWorkerRequest, signal: AbortSignal) {
    if (request.operation === "probe") {
      return { lease: this.scheduler.reserve(request.operation), stagedModel: undefined };
    }
    const resident = await this.prepareModel(request.modelId, request.operation, signal);
    return { lease: resident.lease, stagedModel: resident.stagedModel };
  }

  private async executeOne(
    request: InferenceWorkerRequest,
    execution: ActiveExecution,
    onThinkingDelta?: (text: string) => void,
  ) {
    let resourcesPrepared = false;
    let lease: ResourceLease | undefined;
    try {
      this.startTimedExecution(execution);
      const resources = await this.resources(request, execution.signal);
      lease = resources.lease;
      resourcesPrepared = true;
      execution.signal.throwIfAborted();
      const response = await this.execute(request, execution, resources.lease, {
        ...(resources.stagedModel === undefined ? {} : { stagedModel: resources.stagedModel }),
        ...(onThinkingDelta === undefined ? {} : { onThinkingDelta }),
      });
      return { response, lease: resources.lease };
    } catch (error) {
      const recoverableStructuredMiss =
        error instanceof Error && error.message === "structured_tool_call_required";
      if (resourcesPrepared && request.operation !== "probe" && !recoverableStructuredMiss) {
        await this.releaseResident();
      }
      if (request.operation === "probe") lease?.release();
      throw error;
    }
  }

  private async run(
    request: InferenceWorkerRequest,
    signal?: AbortSignal,
    onThinkingDelta?: (text: string) => void,
  ) {
    const execution = this.startExecution(signal);
    let lease: ResourceLease | undefined;
    try {
      const result = await this.serial.run(async () => {
        return await this.executeOne(request, execution, onThinkingDelta);
      }, execution.signal);
      lease = result.lease;
      return result.response;
    } catch (error) {
      const failure = execution.signal.aborted ? inferenceAbortFailure(execution.signal) : error;
      recordInferenceAudit(this.audit, {
        operation: request.operation,
        requestId: request.requestId,
        jobId: request.jobId,
        outcome: "failed",
        code: inferenceFailureCode(failure),
      });
      throw failure;
    } finally {
      if (request.operation === "probe") lease?.release();
      this.finishExecution(execution);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const active = [...this.active.entries()];
    for (const [controller] of active) {
      controller.abort(new InferenceFailure("cancelled", "Inference supervisor closed."));
    }
    await Promise.all(active.map(([, finished]) => finished));
    await this.releaseResident();
  }

  async modelStatus() {
    return modelRuntimeStatus(this.active.size > 0, this.resident !== undefined, this.measurements);
  }

  async unloadModel(): Promise<boolean> {
    if (this.active.size > 0) return false;
    const unloaded = await this.releaseResident();
    this.audit({
      type: "inference.model_unloaded",
      outcome: unloaded ? "succeeded" : "failed",
      metadata: { modelId: DEFAULT_MODEL_ID },
    });
    return unloaded;
  }

  async generate(
    input: GenerationInput,
    signal?: AbortSignal,
    onThinkingDelta?: (text: string) => void,
    identity?: GenerationRequestIdentity,
  ): Promise<StructuredGenerationResult> {
    const request = createGenerationRequest(input, identity);
    const response = await this.run(
      {
        protocolVersion: 1,
        requestId: request.identity.requestId,
        jobId: request.identity.jobId,
        operation: "generate",
        ...request.input,
      },
      signal,
      onThinkingDelta,
    );
    if (response.status !== "ok" || response.operation !== "generate") {
      throw new Error("unexpected_inference_response");
    }
    return response;
  }

  async embed(input: EmbeddingInput, signal?: AbortSignal): Promise<EmbeddingResult> {
    const response = await this.run(
      {
        protocolVersion: 1,
        requestId: randomUUID(),
        jobId: JobIdSchema.parse(randomUUID()),
        operation: "embed",
        ...input,
      },
      signal,
    );
    if (response.status !== "ok" || response.operation !== "embed") {
      throw new Error("unexpected_inference_response");
    }
    return response;
  }
}

import type { AuditEventInput, InferenceOperation, InferenceWorkerRequest } from "@vault/shared";
import type {
  ChatInput,
  EmbeddingInput,
  GenerationInput,
  GenerationRequestIdentity,
  ImageInferencePort,
  InferencePort,
  InferenceService,
  InferenceStreamCallbacks,
} from "./inference.js";
import { recordInferenceAudit } from "./inference-audit.js";
import {
  InferenceFailure,
  inferenceAbortFailure,
  inferenceFailureCode,
} from "./inference-errors.js";
import { type ActiveInferenceExecution, inferenceTimeoutMs } from "./inference-timeout.js";
import {
  DEFAULT_MODEL_ID,
  generationMeasurements,
  lastKnownContext,
  modelRuntimeStatus,
} from "./model-status.js";
import type { ModelResolver } from "./models.js";
import type { ResourceScheduler } from "./scheduler.js";
import { AsyncSerial } from "./serial.js";
import { ImageInferenceController } from "./supervisor-image.js";
import {
  createChatWorkerRequest,
  createEmbedWorkerRequest,
  createGenerateWorkerRequest,
  expectChatResponse,
  expectEmbedResponse,
  expectGenerateResponse,
} from "./supervisor-requests.js";

type AuditAppender = (event: AuditEventInput) => void;
type ResourceLease = ReturnType<ResourceScheduler["reserve"]>;
type StagedModel = Awaited<ReturnType<ModelResolver["resolve"]>>;

export class InferenceSupervisor extends ImageInferenceController implements InferenceService {
  private readonly residency = new AsyncSerial();
  private measurements: Parameters<typeof modelRuntimeStatus>[2] = {};
  private resident:
    | {
        modelId: string;
        operation: InferenceOperation;
        stagedModel: StagedModel;
        lease: ResourceLease;
      }
    | undefined;
  // biome-ignore lint/complexity/useMaxParams: explicit ports keep inference authorities visible.
  constructor(
    private readonly port: InferencePort,
    models: ModelResolver,
    scheduler: ResourceScheduler,
    audit: AuditAppender,
    imagePort?: ImageInferencePort,
  ) {
    super(models, scheduler, audit, imagePort);
  }

  private async execute(
    request: InferenceWorkerRequest,
    execution: ActiveInferenceExecution,
    lease: ResourceLease,
    options: InferenceStreamCallbacks & { stagedModel?: StagedModel },
  ) {
    const { stagedModel, ...streams } = options;
    const response = await this.port.execute({
      request,
      ...(stagedModel === undefined ? {} : { modelPath: stagedModel.path }),
      memoryBudgetBytes: lease.memoryBudgetBytes,
      timeoutMs: Math.max(1, execution.timeoutMs - (Date.now() - execution.startedAt)),
      signal: execution.signal,
      ...streams,
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
    if (response.operation === "generate" || response.operation === "chat") {
      this.measurements = generationMeasurements(response.memory);
      if (response.memory.sequenceCount !== undefined)
        this.slots.setCapacity(response.memory.sequenceCount);
    }
    recordInferenceAudit(this.audit, {
      operation: request.operation,
      requestId: request.requestId,
      jobId: request.jobId,
      outcome: "succeeded",
    });
    return response;
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

  protected async releaseResident(): Promise<boolean> {
    const resident = this.resident;
    this.resident = undefined;
    this.measurements = lastKnownContext(this.measurements);
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
    // Serialize only resident preparation so concurrent generations never race model load;
    // generation itself stays parallel across the model's context sequences.
    const resident = await this.residency.run(
      () => this.prepareModel(request.modelId, request.operation, signal),
      signal,
    );
    return { lease: resident.lease, stagedModel: resident.stagedModel };
  }

  private async executeOne(
    request: InferenceWorkerRequest,
    execution: ActiveInferenceExecution,
    streams: InferenceStreamCallbacks = {},
  ) {
    let resourcesPrepared = false;
    let lease: ResourceLease | undefined;
    try {
      this.startTimedExecution(execution, inferenceTimeoutMs(request));
      const resources = await this.resources(request, execution.signal);
      lease = resources.lease;
      resourcesPrepared = true;
      execution.signal.throwIfAborted();
      const response = await this.execute(request, execution, resources.lease, {
        ...(resources.stagedModel === undefined ? {} : { stagedModel: resources.stagedModel }),
        ...streams,
      });
      return { response, lease: resources.lease };
    } catch (error) {
      const recoverableStructuredMiss =
        error instanceof Error &&
        ["structured_tool_call_required", "generation_token_limit"].includes(error.message);
      if (resourcesPrepared && request.operation !== "probe" && !recoverableStructuredMiss) {
        await this.releaseResident();
      }
      if (request.operation === "probe") lease?.release();
      throw error;
    }
  }

  private async run(
    request: InferenceWorkerRequest,
    options: InferenceStreamCallbacks & {
      signal?: AbortSignal;
      priority?: "primary" | "secondary";
    } = {},
  ) {
    const { signal, priority = "primary", ...streams } = options;
    const execution = this.startExecution(signal);
    let lease: ResourceLease | undefined;
    try {
      const result = await this.slots.run(
        async () => await this.executeOne(request, execution, streams),
        { signal: execution.signal, priority },
      );
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
  ) {
    const response = await this.run(createGenerateWorkerRequest(input, identity), {
      ...(signal === undefined ? {} : { signal }),
      ...(onThinkingDelta === undefined ? {} : { onThinkingDelta }),
    });
    return expectGenerateResponse(response);
  }

  async chat(
    input: ChatInput,
    signal?: AbortSignal,
    streams?: InferenceStreamCallbacks,
    identity?: GenerationRequestIdentity,
  ) {
    const response = await this.run(createChatWorkerRequest(input, identity), {
      ...(signal === undefined ? {} : { signal }),
      ...streams,
      priority: identity?.priority ?? "primary",
    });
    return expectChatResponse(response);
  }

  async embed(input: EmbeddingInput, signal?: AbortSignal) {
    const response = await this.run(createEmbedWorkerRequest(input), {
      ...(signal === undefined ? {} : { signal }),
    });
    return expectEmbedResponse(response);
  }
}

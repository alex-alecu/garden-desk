import { randomUUID } from "node:crypto";
import type { AuditEventInput } from "@vault/shared";
import { JobIdSchema, RequestIdSchema } from "@vault/shared";
import type { ImageInferencePort, ImageInspectionInput } from "./inference.js";
import { recordInferenceAudit } from "./inference-audit.js";
import {
  InferenceFailure,
  inferenceAbortFailure,
  inferenceFailureCode,
} from "./inference-errors.js";
import type { ActiveInferenceExecution } from "./inference-timeout.js";
import type { ModelResolver } from "./models.js";
import type { ResourceScheduler } from "./scheduler.js";
import { SlotLimiter } from "./slot-limiter.js";

type AuditAppender = (event: AuditEventInput) => void;
type StagedModel = Awaited<ReturnType<ModelResolver["resolve"]>>;

export abstract class ImageInferenceController {
  protected readonly active = new Map<AbortController, Promise<void>>();
  protected readonly slots = new SlotLimiter(1);
  protected closed = false;

  protected constructor(
    protected readonly models: ModelResolver,
    protected readonly scheduler: ResourceScheduler,
    protected readonly audit: AuditAppender,
    private readonly imagePort?: ImageInferencePort,
  ) {}

  protected abstract releaseResident(): Promise<boolean>;

  protected startExecution(signal?: AbortSignal): ActiveInferenceExecution {
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
    return {
      lifecycle,
      signal: operationSignal,
      startedAt: 0,
      timeoutMs: 0,
      finish: finishExecution,
    };
  }

  protected startTimedExecution(execution: ActiveInferenceExecution, timeoutMs: number): void {
    execution.signal.throwIfAborted();
    execution.signal = AbortSignal.any([execution.signal, AbortSignal.timeout(timeoutMs)]);
    execution.startedAt = Date.now();
    execution.timeoutMs = timeoutMs;
  }

  protected finishExecution(execution: ActiveInferenceExecution): void {
    this.active.delete(execution.lifecycle);
    execution.finish();
  }

  private async executeImageInspection(
    input: ImageInspectionInput,
    execution: ActiveInferenceExecution,
  ): Promise<string> {
    if (this.imagePort === undefined)
      throw new InferenceFailure("unsupported", "image_inference_not_packaged");
    await this.releaseResident();
    const lease = this.scheduler.reserve("vision");
    let model: StagedModel | undefined;
    let projector: StagedModel | undefined;
    try {
      model = await this.models.resolve(input.modelId, execution.signal);
      projector = await this.models.resolve(input.projectorModelId, execution.signal);
      const result = await this.imagePort.inspect({
        imagePath: input.imagePath,
        memoryBudgetBytes: lease.memoryBudgetBytes,
        modelPath: model.path,
        projectorPath: projector.path,
        prompt: input.prompt,
        signal: execution.signal,
        timeoutMs: Math.max(1, execution.timeoutMs - (Date.now() - execution.startedAt)),
      });
      return result.text;
    } finally {
      try {
        await projector?.dispose();
      } finally {
        try {
          await model?.dispose();
        } finally {
          lease.release();
        }
      }
    }
  }

  async inspectImage(input: ImageInspectionInput, signal?: AbortSignal): Promise<string> {
    const execution = this.startExecution(signal);
    const requestId = RequestIdSchema.parse(randomUUID());
    const jobId = JobIdSchema.parse(randomUUID());
    try {
      return await this.slots.runExclusive(async () => {
        this.startTimedExecution(execution, 300_000);
        const response = await this.executeImageInspection(input, execution);
        recordInferenceAudit(this.audit, {
          operation: "vision",
          requestId,
          jobId,
          outcome: "succeeded",
        });
        return response;
      }, execution.signal);
    } catch (error) {
      const failure = execution.signal.aborted ? inferenceAbortFailure(execution.signal) : error;
      recordInferenceAudit(this.audit, {
        operation: "vision",
        requestId,
        jobId,
        outcome: "failed",
        code: inferenceFailureCode(failure),
      });
      throw failure;
    } finally {
      this.finishExecution(execution);
    }
  }
}

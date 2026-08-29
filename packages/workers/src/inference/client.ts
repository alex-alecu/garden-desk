import type { InferenceWorkerResponse } from "@vault/shared";
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

export { type InferenceExecution, InferenceWorkerError } from "./resident-worker.js";

function abortedExecution(signal: AbortSignal | undefined): InferenceWorkerError {
  const code =
    signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError"
      ? "timeout"
      : signal?.reason instanceof Error &&
          "code" in signal.reason &&
          signal.reason.code === "timeout"
        ? "timeout"
        : "cancelled";
  return new InferenceWorkerError(
    code,
    code === "timeout" ? "Inference timed out." : "Inference cancelled.",
  );
}

function launchFailure(error: unknown): Error {
  try {
    if (error instanceof NativeWorkerLaunchError && error.code === "unsupported")
      return new NativeWorkerLaunchError("unsupported", "unsupported_native_worker_platform");
  } catch {
    // Return the fixed worker error below.
  }
  return new InferenceWorkerError("worker_crash", "Inference worker stopped.");
}

async function recordLaunchFailure(execution: InferenceExecution, error: unknown): Promise<void> {
  try {
    if (
      globalThis.__VAULT_DEVELOPMENT_BUILD__ === true &&
      execution.request.operation !== "probe"
    ) {
      await waitForDevelopmentHostRecord(
        recordDevelopmentHostFailure("worker_launch", execution.request.operation, error),
      );
    }
  } catch {
    // Diagnostics must not change inference behavior.
  }
}

export class InferenceWorkerClient {
  private resident: ResidentWorker | undefined;

  constructor(
    private readonly launcher: NativeWorkerLauncher,
    private readonly workerEntryPath: string,
  ) {}

  async execute(execution: InferenceExecution): Promise<InferenceWorkerResponse> {
    if (execution.signal?.aborted) {
      throw abortedExecution(execution.signal);
    }
    const worker = await this.worker(execution);
    if (execution.signal?.aborted) {
      // Cancelling a turn leaves the resident model loaded for the next turn in this or another
      // session; only a missing terminal result unloads it.
      throw abortedExecution(execution.signal);
    }
    try {
      return await worker.execute(execution);
    } finally {
      if (execution.request.operation === "probe" && !worker.busy) await worker.dispose();
    }
  }

  async unload(): Promise<boolean> {
    const worker = this.resident;
    if (worker === undefined) return false;
    if (worker.busy) return false;
    this.resident = undefined;
    await worker.dispose();
    return true;
  }

  private async worker(execution: InferenceExecution): Promise<ResidentWorker> {
    const resident = this.resident;
    const reusable =
      execution.request.operation !== "probe" &&
      resident?.modelPath === execution.modelPath &&
      resident?.memoryBudgetBytes === execution.memoryBudgetBytes;
    if (reusable && resident !== undefined) return resident;
    if (this.resident !== undefined) {
      if (this.resident.busy)
        throw new InferenceWorkerError("worker_crash", "Inference worker is busy.");
      await this.resident.dispose();
      this.resident = undefined;
    }
    const handle = await this.launch(execution);
    const worker = new ResidentWorker(
      handle,
      execution.modelPath,
      execution.memoryBudgetBytes,
      () => {
        if (this.resident === worker) this.resident = undefined;
      },
    );
    if (execution.request.operation !== "probe") this.resident = worker;
    return worker;
  }

  private async launch(execution: InferenceExecution): Promise<NativeWorkerHandle> {
    try {
      return await this.launcher.launch({
        workerEntryPath: this.workerEntryPath,
        ...(execution.modelPath === undefined ? {} : { modelPath: execution.modelPath }),
        memoryBudgetBytes: execution.memoryBudgetBytes,
      });
    } catch (error) {
      await recordLaunchFailure(execution, error);
      throw launchFailure(error);
    }
  }
}

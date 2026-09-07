import type { InferenceWorkerRequest, InferenceWorkerResponse } from "@gardendesk/shared";
import type { NativeWorkerHandle } from "../native/launcher.js";
import { createDevelopmentDiagnosticSink } from "./development-diagnostics.js";
import { encodeInferenceRequest, InferenceResponseDecoder } from "./frames.js";

const WORKER_CRASH_MESSAGE = "Inference worker stopped.";

export interface InferenceExecution {
  request: InferenceWorkerRequest;
  modelPath?: string;
  memoryBudgetBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  reasoning?: Map<string, string>;
  onThinkingDelta?(text: string): void;
  onResponseDelta?(text: string): void;
}

export class InferenceWorkerError extends Error {
  constructor(
    readonly code: "cancelled" | "timeout" | "malformed_worker_message" | "worker_crash",
    message: string,
  ) {
    super(message);
  }
}

function abortCode(signal?: AbortSignal): "cancelled" | "timeout" {
  if (signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError")
    return "timeout";
  if (
    signal?.reason instanceof Error &&
    "code" in signal.reason &&
    signal.reason.code === "timeout"
  )
    return "timeout";
  return "cancelled";
}

interface PendingExchange {
  request: Extract<InferenceWorkerRequest, { operation: "probe" }>;
  signal: AbortSignal;
  accept(response: InferenceWorkerResponse): void;
  reject(error: Error): void;
  cancelled(): void;
}

export class ResidentWorker {
  private readonly decoder = new InferenceResponseDecoder();
  private readonly diagnostics = createDevelopmentDiagnosticSink();
  private pending: PendingExchange | undefined;
  private stopped = false;

  constructor(private readonly handle: NativeWorkerHandle) {
    handle.process.stderr.on("data", this.errorOutput);
    handle.process.stdout.on("data", this.responseOutput);
    handle.process.stdin.on("error", this.inputError);
    handle.process.once("error", this.workerError);
    handle.process.once("close", this.closed);
  }

  execute(
    request: PendingExchange["request"],
    signal: AbortSignal,
  ): Promise<InferenceWorkerResponse> {
    let frame: Buffer;
    try {
      frame = encodeInferenceRequest(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Malformed inference request.";
      return Promise.reject(new InferenceWorkerError("malformed_worker_message", message));
    }
    return new Promise((accept, reject) => {
      const cancelled = () => {
        const code = abortCode(signal);
        this.fail(code, code === "timeout" ? "Inference timed out." : "Inference cancelled.");
      };
      this.pending = {
        request,
        signal,
        accept,
        reject,
        cancelled,
      };
      signal.addEventListener("abort", cancelled, { once: true });
      this.handle.process.stdin.write(frame, (error) => {
        if (error != null) this.fail("worker_crash", WORKER_CRASH_MESSAGE);
      });
    });
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    await this.handle.dispose();
    await this.diagnostics?.close();
  }

  private readonly errorOutput = (chunk: Buffer): void => this.diagnostics?.append(chunk);
  private readonly inputError = (_error: Error): void =>
    this.fail("worker_crash", WORKER_CRASH_MESSAGE);
  private readonly workerError = (_error: Error): void =>
    this.fail("worker_crash", WORKER_CRASH_MESSAGE);
  private readonly responseOutput = (chunk: Buffer): void => {
    try {
      for (const message of this.decoder.push(chunk)) {
        const pending = this.pending;
        if (message.requestId === pending?.request.requestId && message.status !== "stream")
          this.finish(() => pending.accept(message));
      }
    } catch (error) {
      this.fail(
        "malformed_worker_message",
        error instanceof Error ? error.message : "Malformed worker message.",
      );
    }
  };

  private readonly closed = (_code: number | null): void => {
    if (this.stopped) return;
    this.stopped = true;
    void this.diagnostics?.close();
    try {
      this.decoder.finish();
    } catch (error) {
      this.fail(
        "malformed_worker_message",
        error instanceof Error ? error.message : "Malformed worker message.",
      );
      return;
    }
    this.fail("worker_crash", WORKER_CRASH_MESSAGE);
  };

  private fail(code: InferenceWorkerError["code"], message: string): void {
    if (!this.stopped) this.handle.process.kill("SIGKILL");
    const pending = this.pending;
    if (pending !== undefined)
      this.finish(() => pending.reject(new InferenceWorkerError(code, message)));
  }

  private finish(callback: () => void): void {
    const pending = this.pending;
    if (pending === undefined) return;
    this.pending = undefined;
    pending.signal.removeEventListener("abort", pending.cancelled);
    callback();
  }
}

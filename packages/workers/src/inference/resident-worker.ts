import type {
  InferenceWorkerMessage,
  InferenceWorkerRequest,
  InferenceWorkerResponse,
  RequestId,
} from "@vault/shared";
import type { NativeWorkerHandle } from "../native/launcher.js";
import {
  encodeInferenceCancel,
  encodeInferenceRequest,
  InferenceResponseDecoder,
} from "./frames.js";

const CANCELLATION_GRACE_MS = 1_000;

export interface InferenceExecution {
  request: InferenceWorkerRequest;
  modelPath?: string;
  memoryBudgetBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
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
  execution: InferenceExecution;
  accept(response: InferenceWorkerResponse): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
  cancellationTimer: NodeJS.Timeout | undefined;
  cancelling: boolean;
  cancelled(): void;
}

/** Multiplexes framed requests over one resident worker process, keyed by request ID. */
export class ResidentWorker {
  private readonly decoder = new InferenceResponseDecoder();
  private readonly pending = new Map<RequestId, PendingExchange>();
  private stderr = "";
  private stopped = false;

  constructor(
    private readonly handle: NativeWorkerHandle,
    readonly modelPath: string | undefined,
    readonly memoryBudgetBytes: number,
    private readonly onStopped: () => void,
  ) {
    handle.process.stderr.on("data", this.errorOutput);
    handle.process.stdout.on("data", this.responseOutput);
    handle.process.stdin.on("error", this.inputError);
    handle.process.once("error", this.workerError);
    handle.process.once("close", this.closed);
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  execute(execution: InferenceExecution): Promise<InferenceWorkerResponse> {
    const requestId = execution.request.requestId;
    if (this.pending.has(requestId)) {
      return Promise.reject(
        new InferenceWorkerError("malformed_worker_message", "Duplicate inference request ID."),
      );
    }
    let frame: Buffer;
    try {
      frame = encodeInferenceRequest(execution.request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Malformed inference request.";
      return Promise.reject(new InferenceWorkerError("malformed_worker_message", message));
    }
    return new Promise((accept, reject) => {
      const cancelled = () => this.cancel(requestId, abortCode(execution.signal));
      this.pending.set(requestId, {
        execution,
        accept,
        reject,
        cancelled,
        timer: setTimeout(() => this.cancel(requestId, "timeout"), execution.timeoutMs),
        cancellationTimer: undefined,
        cancelling: false,
      });
      execution.signal?.addEventListener("abort", cancelled, { once: true });
      this.handle.process.stdin.write(frame, (error) => {
        if (error != null) this.fail("worker_crash", error.message);
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.handle.dispose();
    this.onStopped();
  }

  private readonly errorOutput = (chunk: Buffer): void => {
    if (this.stderr.length < 65_536) this.stderr += String(chunk);
  };
  private readonly inputError = (error: Error): void => this.fail("worker_crash", error.message);
  private readonly workerError = (error: Error): void => this.fail("worker_crash", error.message);
  private readonly responseOutput = (chunk: Buffer): void => {
    try {
      for (const message of this.decoder.push(chunk)) this.message(message);
    } catch (error) {
      this.fail(
        "malformed_worker_message",
        error instanceof Error ? error.message : "Malformed worker message.",
      );
    }
  };

  private message(message: InferenceWorkerMessage): void {
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) return;
    if (message.status === "stream") {
      if (message.event === "thinking.delta") pending.execution.onThinkingDelta?.(message.text);
      else pending.execution.onResponseDelta?.(message.text);
      return;
    }
    this.finish(message.requestId, () => pending.accept(message));
  }

  private readonly closed = (code: number | null): void => {
    if (this.stopped) return;
    this.stopped = true;
    try {
      this.decoder.finish();
    } catch (error) {
      this.fail(
        "malformed_worker_message",
        error instanceof Error ? error.message : "Malformed worker message.",
      );
      return;
    }
    const exit = `worker exit=${String(code)} signal=${String(this.handle.process.signalCode)}`;
    if (this.pending.size > 0)
      this.fail(
        "worker_crash",
        this.stderr.trim() === "" ? exit : `${this.stderr.trim()}\n${exit}`,
      );
    this.onStopped();
  };

  private fail(code: InferenceWorkerError["code"], message: string): void {
    if (!this.stopped) this.handle.process.kill("SIGKILL");
    for (const requestId of [...this.pending.keys()]) {
      const pending = this.pending.get(requestId);
      if (pending !== undefined)
        this.finish(requestId, () => pending.reject(new InferenceWorkerError(code, message)));
    }
  }

  private cancel(requestId: RequestId, code: "cancelled" | "timeout"): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined || pending.cancelling) return;
    if (this.pending.size === 1) {
      this.failOne(
        requestId,
        code,
        code === "timeout" ? "Inference timed out." : "Inference cancelled.",
      );
      return;
    }
    pending.cancelling = true;
    clearTimeout(pending.timer);
    pending.execution.signal?.removeEventListener("abort", pending.cancelled);
    try {
      this.handle.process.stdin.write(encodeInferenceCancel(requestId, code), (error) => {
        if (error != null) this.fail("worker_crash", error.message);
      });
    } catch (error) {
      this.fail("worker_crash", error instanceof Error ? error.message : "Cancellation failed.");
      return;
    }
    pending.cancellationTimer = setTimeout(
      () => this.fail("worker_crash", "Inference worker did not acknowledge cancellation."),
      CANCELLATION_GRACE_MS,
    );
  }

  private failOne(requestId: RequestId, code: InferenceWorkerError["code"], message: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    if (!this.stopped) this.handle.process.kill("SIGKILL");
    this.finish(requestId, () => pending.reject(new InferenceWorkerError(code, message)));
  }

  private finish(requestId: RequestId, callback: () => void): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (pending.cancellationTimer !== undefined) clearTimeout(pending.cancellationTimer);
    pending.execution.signal?.removeEventListener("abort", pending.cancelled);
    callback();
  }
}

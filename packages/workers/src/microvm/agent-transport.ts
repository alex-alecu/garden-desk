// biome-ignore lint/style/noRestrictedImports: this module is the bounded transport half of the platform launcher.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentGuestUpdateFrame, WorkerFrame } from "@gardendesk/shared";
import { encodeFrame, FrameDecoder } from "../ipc.js";
import type { AgentExecutionObserver } from "./launcher.js";

interface PendingExchange {
  accept(value: WorkerFrame): void;
  reject(error: Error): void;
  executionId: string | undefined;
  expectedSequence: number;
  updates: Promise<void>;
  onUpdate: AgentExecutionObserver["onUpdate"] | undefined;
}

function safeTransportError(message: string, error?: unknown): Error {
  const result = new Error(message);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code !== undefined && /^[A-Za-z0-9_:.-]{1,64}$/u.test(code)) {
    Object.assign(result, { code });
  }
  return result;
}

function isExecutionUpdate(frame: WorkerFrame): frame is AgentGuestUpdateFrame {
  return "operation" in frame && (frame.operation === "stream" || frame.operation === "diagnostic");
}

export class AgentHelperTransport {
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, PendingExchange>();
  private readonly started: Promise<void>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.started = new Promise((accept, reject) => {
      child.once("spawn", accept);
      child.once("error", (error) =>
        reject(safeTransportError("agent_helper_spawn_failed", error)),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => this.received(chunk));
    child.stdin.on("error", (error) =>
      this.fail(safeTransportError("agent_helper_transport_failed", error)),
    );
    child.stderr.resume();
    child.once("close", (code) => {
      this.fail(
        safeTransportError(`agent_helper_exited_${code ?? "signal"}`, {
          code: code === null ? "SIGNAL" : `EXIT_${code}`,
        }),
      );
    });
  }

  private received(chunk: Buffer): void {
    try {
      for (const frame of this.decoder.push(chunk)) this.receiveFrame(frame);
    } catch (error) {
      const message =
        error instanceof Error && /^agent_helper_[a-z_]+$/u.test(error.message)
          ? error.message
          : "agent_helper_protocol_error";
      this.fail(new Error(message));
    }
  }

  private receiveFrame(frame: WorkerFrame): void {
    const key = String(frame.requestId);
    const waiter = this.pending.get(key);
    if (waiter === undefined) throw new Error("agent_helper_unexpected_frame");
    if (isExecutionUpdate(frame)) {
      this.receiveUpdate(waiter, frame);
      return;
    }
    if ("executionId" in frame && frame.executionId !== waiter.executionId) {
      throw new Error("agent_helper_execution_mismatch");
    }
    this.pending.delete(key);
    void waiter.updates.then(() => waiter.accept(frame), waiter.reject);
  }

  private receiveUpdate(waiter: PendingExchange, frame: AgentGuestUpdateFrame): void {
    if (
      waiter.executionId === undefined ||
      frame.executionId !== waiter.executionId ||
      frame.sequence !== waiter.expectedSequence ||
      waiter.onUpdate === undefined
    ) {
      throw new Error("agent_helper_stream_order_invalid");
    }
    waiter.expectedSequence += 1;
    waiter.updates = waiter.updates.then(async () => {
      if (frame.operation === "diagnostic") {
        await waiter.onUpdate?.({
          kind: "diagnostic",
          code: frame.diagnostic.code,
          platform: frame.diagnostic.platform,
        });
        return;
      }
      const bytes = Buffer.from(frame.contentBase64, "base64");
      if (
        bytes.byteLength !== frame.byteLength ||
        bytes.toString("base64") !== frame.contentBase64
      ) {
        throw new Error("agent_helper_stream_chunk_invalid");
      }
      await waiter.onUpdate?.({ kind: "stream", stream: frame.stream, bytes });
    });
  }

  ready(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    return this.started;
  }

  write(frame: WorkerFrame): void {
    if (
      this.child.exitCode !== null ||
      this.child.signalCode !== null ||
      this.child.stdin.destroyed
    ) {
      throw new Error("agent_helper_closed");
    }
    this.child.stdin.write(encodeFrame(frame));
  }

  exchange(
    frame: WorkerFrame,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ): Promise<WorkerFrame> {
    signal?.throwIfAborted();
    const key = String(frame.requestId);
    return new Promise((accept, reject) => {
      const abort = () => {
        this.pending.delete(key);
        this.child.kill("SIGKILL");
        reject(signal?.reason ?? new DOMException("Cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(key, {
        accept: (value) => {
          signal?.removeEventListener("abort", abort);
          accept(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
        executionId: observer?.executionId,
        expectedSequence: 0,
        updates: Promise.resolve(),
        onUpdate: observer?.onUpdate,
      });
      try {
        this.write(frame);
      } catch (error) {
        this.pending.delete(key);
        signal?.removeEventListener("abort", abort);
        reject(safeTransportError("agent_helper_write_failed", error));
      }
    });
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    try {
      this.write({ protocolVersion: 3, requestId: randomUUID(), operation: "shutdown" });
    } catch {
      this.child.kill("SIGKILL");
    }
    await new Promise<void>((accept) => {
      let finished = false;
      const closed = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        accept();
      };
      const timeout = setTimeout(() => {
        this.child.kill("SIGKILL");
        closed();
      }, 5_000);
      this.child.once("close", closed);
      if (this.child.exitCode !== null || this.child.signalCode !== null) closed();
    });
  }

  private fail(error: Error): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

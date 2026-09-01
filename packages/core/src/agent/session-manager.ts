import type { WorkerLimits } from "@gardendesk/shared";
import type {
  AgentExecutionObserver,
  AgentExecutionUpdate,
  AgentSessionExecution,
  CodeAgentLauncher,
  CodeAgentSession,
} from "@gardendesk/workers";
import { agentScriptPreparationFailure } from "./agent-executor.js";
import type { AgentInputResolver, ResolvedAgentInputs } from "./inputs.js";

class LifecycleRelay implements AgentExecutionObserver {
  readonly executionId = "00000000-0000-4000-8000-000000000000";
  private readonly pending: AgentExecutionUpdate[] = [];
  private target: AgentExecutionObserver | undefined;

  async onUpdate(update: AgentExecutionUpdate): Promise<void> {
    if (this.target !== undefined) await this.target.onUpdate(update);
    else if (update.kind === "diagnostic") this.pending.push(update);
  }

  async activate(target: AgentExecutionObserver | undefined): Promise<void> {
    if (target === undefined) return;
    this.target = target;
    for (const update of this.pending.splice(0)) await target.onUpdate(update);
  }

  clear(): void {
    this.target = undefined;
    this.pending.length = 0;
  }
}

interface WarmSession {
  id: string;
  handle: CodeAgentSession;
  inputs: ResolvedAgentInputs;
  lifecycle: LifecycleRelay;
  busy: boolean;
  usedAt: number;
}

export class AgentSessionManager {
  private readonly warm = new Map<string, WarmSession>();
  // FIFO chain per session id. Parallel sub-agents share their parent's session guest, which can
  // run only one execution at a time, so overlapping executions queue here instead of failing with
  // `agent_session_busy`. Keyed by session id so it survives warm-session recreation.
  private readonly executionQueues = new Map<string, Promise<unknown>>();
  private serial: Promise<void> = Promise.resolve();
  private clock = 0;

  constructor(
    private readonly launcher: CodeAgentLauncher,
    private readonly resolver: Pick<AgentInputResolver, "resolve">,
    private readonly limits: WorkerLimits,
    private readonly capacity = 1,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid_agent_capacity");
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.serial;
    let release = (): void => undefined;
    this.serial = new Promise<void>((accept) => {
      release = accept;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private touch(session: WarmSession): void {
    this.clock += 1;
    session.usedAt = this.clock;
  }

  private async makeRoom(): Promise<boolean> {
    if (this.warm.size < this.capacity) return true;
    const idle = [...this.warm.values()]
      .filter((session) => !session.busy)
      .sort((left, right) => left.usedAt - right.usedAt)[0];
    if (idle === undefined) return false;
    await this.closeWarm(idle);
    return true;
  }

  private async ensure(
    sessionId: string,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ): Promise<WarmSession | undefined> {
    signal?.throwIfAborted();
    const existing = this.warm.get(sessionId);
    if (existing !== undefined) {
      this.touch(existing);
      await existing.lifecycle.activate(observer);
      return existing;
    }
    if (!(await this.makeRoom())) return undefined;
    const lifecycle = new LifecycleRelay();
    await lifecycle.activate(observer);
    const inputs = await this.resolver.resolve(sessionId);
    try {
      const handle = await this.launcher.openAgentSession({
        sessionId,
        sourceFolder: inputs.sourceFolder,
        readonlyInputs: inputs.attachments,
        limits: this.limits,
        observer: lifecycle,
        ...(signal === undefined ? {} : { signal }),
      });
      const session = { id: sessionId, handle, inputs, lifecycle, busy: false, usedAt: 0 };
      this.touch(session);
      this.warm.set(sessionId, session);
      return session;
    } catch (error) {
      lifecycle.clear();
      await inputs.dispose();
      throw error;
    }
  }

  warmSession(sessionId: string): Promise<void> {
    return this.exclusive(async () => {
      await this.ensure(sessionId);
    });
  }

  async execute(
    sessionId: string,
    request: AgentSessionExecution,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ) {
    signal?.throwIfAborted();
    const previous = this.executionQueues.get(sessionId) ?? Promise.resolve();
    const tail = previous
      .catch(() => undefined)
      .then(() => {
        signal?.throwIfAborted();
        return this.executeOnce(sessionId, request, signal, observer);
      });
    const settled = tail.catch(() => undefined);
    this.executionQueues.set(sessionId, settled);
    void settled.then(() => {
      // Drop the entry once this is the last queued execution, so idle sessions do not retain a
      // resolved promise forever. A newer execute replaces the entry before this runs.
      if (this.executionQueues.get(sessionId) === settled) this.executionQueues.delete(sessionId);
    });
    // The chain (`settled`) preserves FIFO order for the next caller, while the caller itself may
    // reject as soon as its signal aborts, even while still waiting behind an earlier execution.
    return await this.awaitWithAbort(tail, signal);
  }

  private awaitWithAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return work;
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((accept, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      work.then(accept, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  private async executeOnce(
    sessionId: string,
    request: AgentSessionExecution,
    signal?: AbortSignal,
    observer?: AgentExecutionObserver,
  ) {
    const session = await this.exclusive(async () => {
      const prepared = await this.ensure(sessionId, signal, observer);
      if (prepared === undefined) throw new Error("agent_memory_unavailable");
      prepared.busy = true;
      return prepared;
    });
    try {
      return await session.handle.execute(request, signal, observer);
    } catch (error) {
      if (agentScriptPreparationFailure(error) === undefined) {
        await this.exclusive(async () => {
          if (this.warm.get(sessionId) === session) await this.closeWarm(session);
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      await this.exclusive(async () => {
        if (this.warm.get(sessionId) === session) {
          session.busy = false;
          this.touch(session);
        }
      });
    }
  }

  closeSession(sessionId: string, deleteWorkspace = false): Promise<void> {
    return this.exclusive(async () => {
      const session = this.warm.get(sessionId);
      if (session !== undefined) await this.closeWarm(session);
      if (deleteWorkspace) await this.launcher.deleteWorkspace(sessionId);
    });
  }

  async readWorkspaceFile(sessionId: string, path: string): Promise<Buffer | undefined> {
    return await this.launcher.readWorkspaceFile?.(sessionId, path);
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      for (const session of [...this.warm.values()]) await this.closeWarm(session);
    });
  }

  private async closeWarm(session: WarmSession): Promise<void> {
    this.warm.delete(session.id);
    try {
      await session.handle.close();
    } finally {
      try {
        await session.inputs.dispose();
      } finally {
        session.lifecycle.clear();
      }
    }
  }
}

interface Waiter {
  active: boolean;
  accept(release: () => void): void;
  reject(error: unknown): void;
  signal: AbortSignal;
  cancelled(): void;
}

export class AgentRunCapacity {
  private inUse = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("invalid_agent_capacity");
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    if (this.inUse < this.maximum) {
      this.inUse += 1;
      return Promise.resolve(this.releaseLease());
    }
    return new Promise((accept, reject) => {
      const waiter: Waiter = {
        active: true,
        accept,
        reject,
        signal,
        cancelled: () => {
          if (!waiter.active) return;
          waiter.active = false;
          signal.removeEventListener("abort", waiter.cancelled);
          reject(signal.reason);
        },
      };
      this.waiters.push(waiter);
      signal.addEventListener("abort", waiter.cancelled, { once: true });
    });
  }

  private releaseLease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        if (waiter === undefined || !waiter.active) continue;
        waiter.active = false;
        waiter.signal.removeEventListener("abort", waiter.cancelled);
        waiter.accept(this.releaseLease());
        return;
      }
      this.inUse -= 1;
    };
  }
}

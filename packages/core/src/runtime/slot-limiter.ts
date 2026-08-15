export type SlotPriority = "primary" | "secondary";

interface Waiter {
  admit(): void;
  reject(reason: unknown): void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
}

/**
 * Admits up to `capacity` concurrent operations and queues the rest, so multiple inference turns
 * can share the model's parallel context sequences. Capacity starts at 1 and is raised once the
 * worker reports how many sequences it allocated, so behavior before that is exactly serial.
 *
 * Waiting primary (top-level) requests are always admitted before waiting secondary (sub-agent)
 * requests, so a burst of sub-agent turns can never starve a user's own turn. A queued caller that
 * aborts leaves the queue immediately without consuming a slot.
 */
export class SlotLimiter {
  private active = 0;
  private exclusiveActive = false;
  private readonly exclusive: Waiter[] = [];
  private readonly primary: Waiter[] = [];
  private readonly secondary: Waiter[] = [];

  constructor(private capacity = 1) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid_slot_capacity");
  }

  setCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid_slot_capacity");
    this.capacity = capacity;
    while (
      !this.exclusiveActive &&
      this.exclusive.length === 0 &&
      this.active < this.capacity &&
      this.admitNext()
    ) {
      // Admitting a waiter increments active; the loop stops when capacity or the queues run out.
    }
  }

  async runExclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await this.acquireExclusive(signal);
    try {
      return await operation();
    } finally {
      this.releaseExclusive();
    }
  }

  async run<T>(
    operation: () => Promise<T>,
    options: { signal?: AbortSignal; priority?: SlotPriority } = {},
  ): Promise<T> {
    options.signal?.throwIfAborted();
    await this.acquire(options.priority ?? "primary", options.signal);
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(priority: SlotPriority, signal: AbortSignal | undefined): Promise<void> {
    if (!this.exclusiveActive && this.exclusive.length === 0 && this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((accept, reject) => {
      const queue = priority === "primary" ? this.primary : this.secondary;
      const waiter: Waiter = { admit: () => accept(), reject, signal, onAbort: undefined };
      if (signal !== undefined) {
        const abort = () => {
          signal.removeEventListener("abort", abort);
          const index = queue.indexOf(waiter);
          if (index !== -1) queue.splice(index, 1);
          reject(signal.reason);
        };
        waiter.onAbort = abort;
      }
      queue.push(waiter);
      if (signal !== undefined && waiter.onAbort !== undefined) {
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        if (signal.aborted) waiter.onAbort();
      }
    });
  }

  private acquireExclusive(signal: AbortSignal | undefined): Promise<void> {
    if (!this.exclusiveActive && this.active === 0) {
      this.exclusiveActive = true;
      return Promise.resolve();
    }
    return new Promise<void>((accept, reject) => {
      const waiter: Waiter = { admit: () => accept(), reject, signal, onAbort: undefined };
      if (signal !== undefined) {
        const abort = () => {
          signal.removeEventListener("abort", abort);
          const index = this.exclusive.indexOf(waiter);
          if (index !== -1) this.exclusive.splice(index, 1);
          reject(signal.reason);
        };
        waiter.onAbort = abort;
      }
      this.exclusive.push(waiter);
      if (signal !== undefined && waiter.onAbort !== undefined) {
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        if (signal.aborted) waiter.onAbort();
      }
    });
  }

  private release(): void {
    this.active -= 1;
    if (this.active === 0 && this.admitExclusive()) return;
    if (this.exclusive.length === 0 && this.active < this.capacity) this.admitNext();
  }

  private releaseExclusive(): void {
    this.exclusiveActive = false;
    if (this.admitExclusive()) return;
    while (this.active < this.capacity && this.admitNext()) {
      // Fill all available normal slots after the exclusive operation.
    }
  }

  private admitExclusive(): boolean {
    if (this.exclusiveActive || this.active !== 0) return false;
    const waiter = this.exclusive.shift();
    if (waiter === undefined) return false;
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    this.exclusiveActive = true;
    waiter.admit();
    return true;
  }

  private admitNext(): boolean {
    const waiter = this.primary.shift() ?? this.secondary.shift();
    if (waiter === undefined) return false;
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    this.active += 1;
    waiter.admit();
    return true;
  }
}

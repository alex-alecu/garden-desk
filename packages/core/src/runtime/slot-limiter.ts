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
  private readonly primary: Waiter[] = [];
  private readonly secondary: Waiter[] = [];

  constructor(private capacity = 1) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid_slot_capacity");
  }

  setCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("invalid_slot_capacity");
    this.capacity = capacity;
    while (this.active < this.capacity && this.admitNext()) {
      // Admitting a waiter increments active; the loop stops when capacity or the queues run out.
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
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((accept, reject) => {
      const queue = priority === "primary" ? this.primary : this.secondary;
      const waiter: Waiter = { admit: () => accept(), reject, signal, onAbort: undefined };
      if (signal !== undefined) {
        waiter.onAbort = () => {
          const index = queue.indexOf(waiter);
          if (index !== -1) queue.splice(index, 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      queue.push(waiter);
    });
  }

  private release(): void {
    this.active -= 1;
    if (this.active < this.capacity) this.admitNext();
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

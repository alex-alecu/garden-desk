interface GuestExecutionReservation {
  release(): void;
  start(): void;
}

export class GuestExecutionBudget {
  private reserved = 0;
  started = 0;

  constructor(readonly limit: number) {}

  get remaining(): number {
    return this.limit - this.started - this.reserved;
  }

  recordStarted(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) {
      throw new Error("guest_execution_budget_exceeded");
    }
    this.started += count;
  }

  reserve(count: number): GuestExecutionReservation | undefined {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) return undefined;
    this.reserved += count;
    let pending = count;
    return {
      release: () => {
        this.reserved -= pending;
        pending = 0;
      },
      start: () => {
        if (pending === 0) throw new Error("guest_execution_reservation_empty");
        pending -= 1;
        this.reserved -= 1;
        this.started += 1;
      },
    };
  }
}

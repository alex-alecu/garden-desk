import type { InferenceOperation } from "@gardendesk/shared";

const GiB = 1024 * 1024 * 1024;

export class ResourceScheduler {
  private reservedBytes = 0;

  constructor(readonly budgetBytes: number) {}

  reserve(operation: InferenceOperation): { memoryBudgetBytes: number; release(): void } {
    const requested = operation === "embed" ? 2 * GiB : this.budgetBytes;
    if (this.reservedBytes + requested > this.budgetBytes) {
      throw new Error("inference_memory_budget_exceeded");
    }
    this.reservedBytes += requested;
    let released = false;
    return {
      memoryBudgetBytes: requested,
      release: () => {
        if (released) return;
        released = true;
        this.reservedBytes -= requested;
      },
    };
  }
}

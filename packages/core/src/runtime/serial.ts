export class AsyncSerial {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const previous = this.tail;
    let release = (): void => undefined;
    let acquired = false;
    this.tail = new Promise<void>((accept) => {
      release = accept;
    });
    try {
      await Promise.race([
        previous.then(() => {
          acquired = true;
        }),
        signal === undefined
          ? new Promise<never>(() => undefined)
          : new Promise<never>((_, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            }),
      ]);
      signal?.throwIfAborted();
      return await operation();
    } finally {
      if (acquired) release();
      else void previous.then(release);
    }
  }
}

import { describe, expect, it } from "vitest";
import { SlotLimiter } from "./slot-limiter.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: cohesive suite of small limiter cases.
describe("SlotLimiter", () => {
  it("admits up to capacity concurrently and queues the rest", async () => {
    const limiter = new SlotLimiter(1);
    const first = deferred();
    const active: number[] = [];
    const start = (id: number, gate: Promise<void>) =>
      limiter.run(async () => {
        active.push(id);
        await gate;
      });
    const a = start(1, first.promise);
    const b = start(2, Promise.resolve());
    await Promise.resolve();
    expect(active).toEqual([1]);
    limiter.setCapacity(2);
    await Promise.resolve();
    expect(active).toEqual([1, 2]);
    first.resolve();
    await Promise.all([a, b]);
  });

  it("admits waiting primary requests before secondary ones", async () => {
    const limiter = new SlotLimiter(1);
    const gate = deferred();
    const order: string[] = [];
    const blocker = limiter.run(async () => {
      await gate.promise;
    });
    const secondary = limiter.run(
      async () => {
        order.push("secondary");
      },
      { priority: "secondary" },
    );
    const primary = limiter.run(
      async () => {
        order.push("primary");
      },
      { priority: "primary" },
    );
    gate.resolve();
    await Promise.all([blocker, secondary, primary]);
    expect(order).toEqual(["primary", "secondary"]);
  });

  it("rejects a queued caller that aborts without consuming a slot", async () => {
    const limiter = new SlotLimiter(1);
    const gate = deferred();
    const controller = new AbortController();
    const blocker = limiter.run(async () => {
      await gate.promise;
    });
    const queued = limiter.run(async () => undefined, { signal: controller.signal });
    controller.abort(new DOMException("stop", "AbortError"));
    await expect(queued).rejects.toBeInstanceOf(DOMException);
    let ran = false;
    gate.resolve();
    await blocker;
    await limiter.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("runs an exclusive operation after active work and before queued work", async () => {
    const limiter = new SlotLimiter(2);
    const first = deferred();
    const second = deferred();
    const order: string[] = [];
    const a = limiter.run(async () => {
      order.push("a");
      await first.promise;
    });
    const b = limiter.run(async () => {
      order.push("b");
      await second.promise;
    });
    const vision = limiter.runExclusive(async () => {
      order.push("vision");
    });
    const next = limiter.run(async () => {
      order.push("next");
    });
    await Promise.resolve();
    expect(order).toEqual(["a", "b"]);
    first.resolve();
    await Promise.resolve();
    expect(order).toEqual(["a", "b"]);
    second.resolve();
    await Promise.all([a, b, vision, next]);
    expect(order).toEqual(["a", "b", "vision", "next"]);
  });
});

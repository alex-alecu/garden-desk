import { describe, expect, it, vi } from "vitest";
import { AgentRunCapacity } from "./run-capacity.js";

describe("agent run memory capacity", () => {
  it("queues work above capacity and releases it in order", async () => {
    const capacity = new AgentRunCapacity(1);
    const first = await capacity.acquire(new AbortController().signal);
    const secondReady = vi.fn();
    const second = capacity.acquire(new AbortController().signal).then((release) => {
      secondReady();
      return release;
    });

    await Promise.resolve();
    expect(secondReady).not.toHaveBeenCalled();
    first();
    const releaseSecond = await second;
    expect(secondReady).toHaveBeenCalledOnce();
    releaseSecond();
  });

  it("removes a cancelled queued run without consuming capacity", async () => {
    const capacity = new AgentRunCapacity(1);
    const first = await capacity.acquire(new AbortController().signal);
    const controller = new AbortController();
    const queued = capacity.acquire(controller.signal);
    controller.abort(new DOMException("Cancelled.", "AbortError"));
    await expect(queued).rejects.toMatchObject({ name: "AbortError" });
    first();
    await expect(capacity.acquire(new AbortController().signal)).resolves.toBeTypeOf("function");
  });
});

import type { ChatMessage } from "@vault/shared";
import { afterEach, expect, it, vi } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";

const unusedExecutor = {
  async execute() {
    throw new Error("unused");
  },
};

afterEach(() => vi.useRealTimers());

function withoutCurrentTime(messages: readonly ChatMessage[]): ChatMessage[] {
  const first = messages[0];
  if (first?.role !== "system") throw new Error("Expected the system message.");
  return [
    { role: "system", text: first.text.split("\n\nCurrent host date and time:")[0] ?? "" },
    ...messages.slice(1),
  ];
}

it("retries one recoverable failure before the first model response", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T12:34:56.789Z"));
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  let call = 0;
  const loop = new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      call += 1;
      if (call === 1) {
        vi.setSystemTime(new Date("2026-08-14T12:35:00.000Z"));
        throw new InferenceFailure("worker_crash", "Worker stopped.");
      }
      return generated("Recovered.");
    },
  });

  const result = await loop.run(input(unusedExecutor, []));

  expect(result.response).toBe("Recovered.");
  expect(requests).toHaveLength(2);
  const first = requests[0]?.messages ?? [];
  const second = requests[1]?.messages ?? [];
  expect(withoutCurrentTime(first)).toEqual(withoutCurrentTime(second));
  expect(first[0]).toEqual(
    expect.objectContaining({ text: expect.stringContaining("2026-08-14T12:34:56.789Z") }),
  );
  expect(second[0]).toEqual(
    expect.objectContaining({ text: expect.stringContaining("2026-08-14T12:35:00.000Z") }),
  );
});

it.each(["cancelled", "timeout", "out_of_memory", "not_found", "unsupported"] as const)(
  "does not retry a permanent %s failure",
  async (code) => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop({
      async chat(request) {
        requests.push(structuredClone(request));
        throw new InferenceFailure(code, `Model failed: ${code}`);
      },
    });

    await expect(loop.run(input(unusedExecutor, []))).rejects.toMatchObject({ code });
    expect(requests).toHaveLength(1);
  },
);

it("uses at most one inference retry during the complete run", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  let call = 0;
  const loop = new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      call += 1;
      if (call === 1 || call === 3) throw new InferenceFailure("worker_crash", "Worker stopped.");
      return generated("", [tool("list", "call-1", { path: "/source" })]);
    },
  });
  const executor = {
    async inspect(run: Parameters<typeof source>[0]) {
      return execution(source(run));
    },
    async execute(run: Parameters<typeof source>[0]) {
      return execution(source(run));
    },
  };

  await expect(loop.run(input(executor, ["list"]))).rejects.toMatchObject({
    code: "worker_crash",
  });
  expect(requests).toHaveLength(3);
});

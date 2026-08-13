import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";

const unusedExecutor = {
  async execute() {
    throw new Error("unused");
  },
};

it("retries one recoverable failure before the first model response", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  let call = 0;
  const loop = new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      call += 1;
      if (call === 1) throw new InferenceFailure("worker_crash", "Worker stopped.");
      return generated("Recovered.");
    },
  });

  const result = await loop.run(input(unusedExecutor, []));

  expect(result.response).toBe("Recovered.");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.messages).toEqual(requests[1]?.messages);
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

import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { InferenceFailure } from "../runtime/inference-errors.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

describe("ChatAgentLoop compaction", () => {
  it("compacts from used context while retaining the current request and last two assistant turns", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const contextReports: Array<{ used: number; allocated: number }> = [];
    const first = generated("", [tool("list", "call-1", { path: "/source" })], 100);
    Object.assign(first, { contextUsedTokens: 6_554 });
    const loop = new ChatAgentLoop(
      model([first, generated("Older work is complete."), generated("Done.")], requests),
    );
    const history = {
      messages: [
        { role: "user" as const, content: "oldest user turn" },
        { role: "assistant" as const, content: "oldest assistant turn" },
        { role: "user" as const, content: "older user turn" },
        { role: "assistant" as const, content: "older assistant turn" },
        { role: "user" as const, content: "recent user turn" },
        { role: "assistant" as const, content: "recent assistant turn" },
      ],
    };

    await loop.run(
      input(
        {
          async execute(run) {
            return execution(source(run));
          },
          async inspect(run) {
            return execution(source(run));
          },
        },
        ["list"],
        {
          history,
          task: "current user turn",
          onContext(used, allocated) {
            contextReports.push({ used, allocated });
          },
        },
      ),
    );

    expect(contextReports[0]).toEqual({ used: 6_554, allocated: 8_192 });
    expect(requests[1]?.messages[1]).toMatchObject({
      role: "user",
      text: expect.stringContaining("oldest user turn"),
    });
    expect(requests[2]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: expect.stringContaining("<anchored-summary>"),
        }),
        expect.objectContaining({ role: "user", text: "current user turn" }),
        expect.objectContaining({ role: "assistant", text: "recent assistant turn" }),
        expect.objectContaining({ role: "assistant", toolCalls: expect.any(Array) }),
      ]),
    );
  });
});

describe("ChatAgentLoop failed execution context", () => {
  it("keeps three different failed attempts available to the model", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const failures = ["call-1", "call-2", "call-3"].map((id) =>
      generated("", [tool("list", id, { path: `/source/${id}` })]),
    );
    const loop = new ChatAgentLoop(model([...failures, generated("New approach.")], requests));
    const failedExecutor = {
      async inspect(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
      async execute(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
    };

    await loop.run(input(failedExecutor, ["list"]));

    const failuresInContext = (requests[3]?.messages ?? []).filter(
      (message) => message.role === "tool" && message.result.includes("permission denied"),
    );
    expect(
      failuresInContext.map((message) => message.role === "tool" && message.toolCallId),
    ).toEqual(["call-1", "call-2", "call-3"]);
  });
});

describe("ChatAgentLoop inference recovery", () => {
  it("compacts established history and retries once after an inference failure", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const replies = [
      generated("", [tool("list", "call-1", { path: "/source" })]),
      generated("Recovered context."),
      generated("Done after retry."),
    ];
    let call = 0;
    const loop = new ChatAgentLoop({
      async chat(request) {
        requests.push(structuredClone(request));
        call += 1;
        if (call === 2) throw new Error("context window exceeded");
        return replies.shift() as ReturnType<typeof generated>;
      },
    });
    const executor = {
      async execute(run: Parameters<typeof source>[0]) {
        return execution(source(run));
      },
      async inspect(run: Parameters<typeof source>[0]) {
        return execution(source(run));
      },
    };

    const result = await loop.run(
      input(executor, ["list"], {
        history: {
          messages: [
            { role: "user", content: "old question" },
            { role: "assistant", content: "old answer" },
            { role: "user", content: "recent question" },
            { role: "assistant", content: "recent answer" },
          ],
        },
      }),
    );

    expect(result.response).toBe("Done after retry.");
    expect(requests[2]?.tools).toEqual([]);
    expect(requests[3]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: expect.stringContaining("<anchored-summary>"),
        }),
      ]),
    );
  });
});

describe("ChatAgentLoop inference retry cap", () => {
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
});

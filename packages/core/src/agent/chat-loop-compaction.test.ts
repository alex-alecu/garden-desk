import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

describe("ChatAgentLoop compaction", () => {
  it("compacts at 80 percent while retaining the current request and last two assistant turns", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [tool("list", "call-1", { path: "/source" })], 6_554),
          generated("Older work is complete."),
          generated("Done."),
        ],
        requests,
      ),
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
        { history, task: "current user turn" },
      ),
    );

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

describe("ChatAgentLoop failed-tool compaction", () => {
  it("replaces three failed tool attempts with an anchored summary", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const failures = ["call-1", "call-2", "call-3"].map((id) =>
      generated("", [tool("list", id, { path: "/source" })]),
    );
    const loop = new ChatAgentLoop(
      model(
        [...failures, generated("Failed inspection summary."), generated("New approach.")],
        requests,
      ),
    );
    const failedExecutor = {
      async inspect(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
      async execute(run: Parameters<typeof source>[0]) {
        return execution(source(run), "permission denied", 1);
      },
    };

    await loop.run(input(failedExecutor, ["list"]));

    expect(requests[4]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          text: expect.stringContaining("Failed inspection summary."),
        }),
        expect.objectContaining({ role: "user", text: "Complete the task." }),
        expect.objectContaining({
          role: "system",
          text: expect.stringContaining("Three consecutive tool attempts failed"),
        }),
      ]),
    );
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

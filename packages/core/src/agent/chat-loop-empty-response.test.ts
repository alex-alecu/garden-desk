import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

it("accepts a valid answer after one empty answer", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(model([generated(""), generated("Done.")], requests));
  const result = await loop.run(
    input(
      {
        async execute() {
          throw new Error("unused");
        },
      },
      [],
    ),
  );
  expect(result.response).toBe("Done.");
  expect(requests).toHaveLength(2);
});

it("allows one empty answer retry with retained execution evidence", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [tool("node", "call-1", { source: "console.log(2)" })]),
        generated(""),
        generated("Two."),
      ],
      requests,
    ),
  );
  const result = await loop.run(
    input(
      {
        async execute(run) {
          return execution(source(run));
        },
      },
      ["node"],
    ),
  );
  expect(result.response).toBe("Two.");
  expect(requests[2]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("previous answer was empty") }),
    ]),
  );
});

it("ends empty-answer recovery after a valid tool call", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated(""),
        generated("", [tool("node", "call-1", { source: "console.log(2)" })]),
        generated(""),
        generated("Two."),
      ],
      requests,
    ),
  );
  const result = await loop.run(
    input(
      {
        async execute(run) {
          return execution(source(run));
        },
      },
      ["node"],
    ),
  );
  expect(result.response).toBe("Two.");
  expect(requests).toHaveLength(4);
});

it("fails when the retry is also empty", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(model([generated(""), generated("")], requests));
  await expect(
    loop.run(
      input(
        {
          async execute() {
            throw new Error("unused");
          },
        },
        [],
      ),
    ),
  ).rejects.toThrow("agent_empty_response");
  expect(requests).toHaveLength(2);
});

it("fails immediately when the final available turn is empty", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(model([generated("")], requests));
  const runInput = input(
    {
      async execute() {
        throw new Error("unused");
      },
    },
    [],
  );
  runInput.agent.steps = 1;
  await expect(loop.run(runInput)).rejects.toThrow("agent_empty_response");
  expect(requests).toHaveLength(1);
});

it("does not grant another empty retry after raw protocol recovery", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated(""),
        generated('<|tool_call>call:python{source:"print(2)"}<tool_call|>'),
        generated(""),
      ],
      requests,
    ),
  );
  await expect(
    loop.run(
      input(
        {
          async execute() {
            throw new Error("unused");
          },
        },
        ["python"],
      ),
    ),
  ).rejects.toThrow("agent_empty_response");
  expect(requests).toHaveLength(3);
});

it("does not grant another empty retry after invalid tool input", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated(""),
        generated("", [
          tool("python", "call-bad", {
            source: "print(2)<tool_call|><|tool_call>call:python{{",
          }),
        ]),
        generated(""),
      ],
      requests,
    ),
  );
  await expect(
    loop.run(
      input(
        {
          async execute() {
            throw new Error("must not execute");
          },
        },
        ["python"],
      ),
    ),
  ).rejects.toThrow("agent_empty_response");
  expect(requests).toHaveLength(3);
});

it("keeps empty-answer recovery bounded after a max-token retry", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const limited = generated("unfinished", [], 7_000);
  limited.stopReason = "maxTokens";
  const loop = new ChatAgentLoop(
    model([limited, generated("Compacted context."), generated(""), generated("")], requests),
  );
  await expect(
    loop.run(
      input(
        {
          async execute() {
            throw new Error("unused");
          },
        },
        [],
      ),
    ),
  ).rejects.toThrow("agent_empty_response");
  expect(requests).toHaveLength(4);
});

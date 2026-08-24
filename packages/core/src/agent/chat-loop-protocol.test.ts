import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";
import { visibleResponseText } from "./chat-protocol.js";
import type { AgentTraceStore } from "./trace-store.js";

function outcomeTrace(outcomes: string[]): AgentTraceStore {
  let sequence = 0;
  return {
    async begin() {
      sequence += 1;
      return `turn-${sequence}`;
    },
    async captureResponse() {},
    recordOutcome(_turnId: string, outcome: string) {
      outcomes.push(outcome);
    },
  } as unknown as AgentTraceStore;
}

it("removes only a leading model channel prelude from visible response text", () => {
  expect(visibleResponseText('<|"|>thought\n<channel|>Visible answer.')).toBe("Visible answer.");
  expect(visibleResponseText("<|channel|>analysis<|message|>Visible answer.")).toBe(
    "Visible answer.",
  );
  expect(visibleResponseText("<|channel>\nVisible answer.")).toBe("Visible answer.");
  expect(visibleResponseText("<|channel>Visible answer.")).toBe("<|channel>Visible answer.");
  expect(visibleResponseText("Visible answer.\n<|channel>")).toBe("Visible answer.\n<|channel>");
  expect(visibleResponseText("<|channel>\n<|channel>\nVisible answer.")).toBe(
    "<|channel>\nVisible answer.",
  );
  expect(visibleResponseText("The literal marker is `<|channel|>`.")).toBe(
    "The literal marker is `<|channel|>`.",
  );
});

it("rejects raw tool markup and retries with a real tool call", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const outcomes: string[] = [];
  const trace = outcomeTrace(outcomes);
  const loop = new ChatAgentLoop(
    model(
      [
        generated('<|tool_call>call:python{source:"print(2)"}<tool_call|>'),
        generated("", [tool("python", "call-1", { source: "print(2)" })]),
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
      ["python"],
      { trace: { runId: "11111111-1111-4111-8111-111111111111", store: trace } },
    ),
  );
  expect(result.response).toBe("Two.");
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        text: expect.stringContaining("raw function-call protocol text"),
      }),
    ]),
  );
  expect(outcomes).toEqual([
    "rejected_unbacked_response",
    "accepted_tool_calls",
    "accepted_response",
  ]);
});

it("accepts a plain response that quotes one protocol marker", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model([generated("The literal marker is `<|tool_call>`.")], requests),
  );

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

  expect(result.response).toBe("The literal marker is `<|tool_call>`.");
});
it("rejects a raw tool-call terminator used as the complete response", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model([generated("<tool_call|>"), generated("Completed result.")], requests),
  );

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

  expect(result.response).toBe("Completed result.");
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        text: expect.stringContaining("raw function-call protocol text"),
      }),
    ]),
  );
});
it("keeps typed tools after an output-limit retry emits raw tool markup", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const limited = generated("unfinished");
  limited.stopReason = "maxTokens";
  const loop = new ChatAgentLoop(
    model(
      [
        limited,
        generated('<|tool_call>call:python{source:"print(2)"}<tool_call|>'),
        generated("", [tool("python", "call-1", { source: "print(2)" })]),
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
      ["python"],
    ),
  );

  expect(result.response).toBe("Two.");
  expect(requests[1]?.tools).toHaveLength(1);
  expect(requests[2]?.tools).toHaveLength(1);
});
it("fails a corrupt call but runs a valid sibling from the same turn", async () => {
  const executed: string[] = [];
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [
          tool("python", "call-bad", {
            source: "print(2)",
            metadata: [{ fragment: "}}<tool_call|><|tool_call>call:python{{" }],
          }),
          tool("python", "call-good", { source: "print(3)" }),
        ]),
        generated("Three."),
      ],
      requests,
    ),
  );

  const result = await loop.run(
    input(
      {
        async execute(run) {
          executed.push(source(run));
          return execution(source(run));
        },
      },
      ["python"],
    ),
  );

  expect(result.response).toBe("Three.");
  expect(executed).toEqual(["print(3)"]);
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "assistant", toolCalls: expect.any(Array) }),
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-bad",
        name: "python",
        result: expect.stringContaining("protocol-control transition"),
      }),
      expect.objectContaining({ role: "tool", toolCallId: "call-good", name: "python" }),
    ]),
  );
});

it("keeps the failed result so a corrected call can run on the next turn", async () => {
  const executed: string[] = [];
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [
          tool("python", "call-bad", {
            source: "print(2)\n}}<tool_call|><|channel>analysis<|tool_call>call:python{{",
          }),
        ]),
        generated("", [tool("python", "call-good", { source: "print(2)" })]),
        generated("Two."),
      ],
      requests,
    ),
  );

  const result = await loop.run(
    input(
      {
        async execute(run) {
          executed.push(source(run));
          return execution(source(run));
        },
      },
      ["python"],
    ),
  );

  expect(result.response).toBe("Two.");
  expect(executed).toEqual(["print(2)"]);
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-bad",
        result: expect.stringContaining("protocol-control transition"),
      }),
    ]),
  );
});

it("accepts one protocol marker used as ordinary argument data", async () => {
  const executed: string[] = [];
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const sourceText = 'print("<|tool_call>")';
  const loop = new ChatAgentLoop(
    model(
      [generated("", [tool("python", "call-marker", { source: sourceText })]), generated("Done.")],
      requests,
    ),
  );

  const result = await loop.run(
    input(
      {
        async execute(run) {
          executed.push(source(run));
          return execution(source(run));
        },
      },
      ["python"],
    ),
  );

  expect(result.response).toBe("Done.");
  expect(executed).toEqual([sourceText]);
});

import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";
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

describe("ChatAgentLoop protocol-text rejection", () => {
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
});

describe("ChatAgentLoop protocol-text response-only recovery", () => {
  it("restores typed tools after a response-only retry emits raw tool markup", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const limited = generated("unfinished");
    limited.stopReason = "maxTokens";
    const loop = new ChatAgentLoop(
      model(
        [
          limited,
          generated("Retained evidence."),
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
    expect(requests[2]?.tools).toEqual([]);
    expect(requests[3]?.tools).toHaveLength(1);
  });
});

describe("ChatAgentLoop structured protocol-text rejection", () => {
  it("rejects protocol-control text inside parsed tool arguments without execution", async () => {
    const executed: string[] = [];
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [
            tool("python", "call-bad", {
              source: "print(2)\n}}<tool_call|><|tool_call>call:python{{",
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
  });
});

describe("ChatAgentLoop empty response recovery", () => {
  it("retries an empty final turn with retained execution evidence", async () => {
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
});

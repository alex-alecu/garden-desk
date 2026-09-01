import { AgentRunResultSchema } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

describe("ChatAgentLoop initial activity", () => {
  it.each([
    { expected: "Loading the local model into memory.", modelNeedsLoad: true },
    { expected: "Understanding the task.", modelNeedsLoad: false },
  ] as const)(
    "reports the correct first step when modelNeedsLoad is $modelNeedsLoad",
    async ({ expected, modelNeedsLoad }) => {
      const events: string[] = [];
      const loop = new ChatAgentLoop(model([generated("Done.")], []));

      await loop.run(
        input(
          {
            async execute() {
              throw new Error("execution_should_not_start");
            },
          },
          [],
          {
            modelNeedsLoad,
            onEvent: (type, summary) => {
              if (type === "inference.started") events.push(summary);
            },
          },
        ),
      );

      expect(events).toEqual([expected]);
    },
  );
});

describe("ChatAgentLoop response streaming", () => {
  it("replaces intermediate text before streaming the accepted answer", async () => {
    const responses: Array<string | null> = [];
    const results = [
      generated("I will inspect it.", [tool("python", "call-1", { source: "print(2)" })]),
      generated("Two."),
    ];
    const loop = new ChatAgentLoop({
      async chat(_request, _signal, streams) {
        const result = results.shift();
        if (result === undefined) throw new Error("Missing chat result.");
        streams?.onResponseDelta?.(result.text);
        return result;
      },
    });

    await loop.run(
      input(
        {
          async execute(run) {
            return execution(source(run));
          },
        },
        ["python"],
        { onResponse: (response) => responses.push(response) },
      ),
    );

    expect(responses).toEqual([null, "I will inspect it.", null, null, "Two.", "Two."]);
  });
});

describe("ChatAgentLoop tool conversation", () => {
  it("returns a tool result as history to the next model turn", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [generated("", [tool("python", "call-1", { source: "print(2)" })]), generated("Two.")],
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
    expect(requests[0]?.maxTokens).toBe(4_096);
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: [tool("python", "call-1", { source: "print(2)" })],
        }),
        expect.objectContaining({
          role: "tool",
          toolCallId: "call-1",
          name: "python",
          result: expect.stringContaining("stdout:\ndone"),
        }),
      ]),
    );
  });
});

describe("ChatAgentLoop malformed Python", () => {
  it("executes malformed Python and returns its SyntaxError to the repair turn", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const program = "if True print('broken')";
    const syntaxError =
      "  File \".garden-desk-tools/test.py\", line 1\n    if True print('broken')\n            ^^^^^\nSyntaxError: invalid syntax";
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [tool("python", "call-1", { source: program })]),
          generated("I repaired it."),
        ],
        requests,
      ),
    );
    const executed: string[] = [];

    await loop.run(
      input(
        {
          async execute(run) {
            executed.push(source(run));
            return execution(source(run), syntaxError, 1);
          },
        },
        ["python"],
      ),
    );

    expect(executed).toEqual([program]);
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          result: expect.stringContaining("SyntaxError: invalid syntax"),
        }),
      ]),
    );
  });
});

describe("ChatAgentLoop automatic context", () => {
  it("keeps the cold auto request stable while budgeting from the allocated context", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const first = generated("", [tool("list", "call-1", { path: "/source" })]);
    first.memory.contextSizeTokens = 65_536;
    const loop = new ChatAgentLoop(model([first, generated("Done.")], requests));

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
        { contextTokens: "auto" },
      ),
    );

    expect(requests[0]).toMatchObject({ contextSize: "auto", maxTokens: 4_096 });
    expect(requests[1]).toMatchObject({ contextSize: "auto", maxTokens: 16_384 });
  });
});

describe("ChatAgentLoop turn limit", () => {
  it("keeps typed tools available on the last allowed model turn", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model([generated("", [tool("python", "last", { source: "print('last')" })])], requests),
    );
    const runInput = input(
      {
        async execute() {
          throw new Error("unused");
        },
      },
      ["python"],
    );

    await expect(loop.run({ ...runInput, agent: { ...runInput.agent, steps: 1 } })).rejects.toThrow(
      "agent_turn_limit_exceeded",
    );

    expect(requests[0]?.tools).toHaveLength(1);
  });
});

describe("run result execution ceiling", () => {
  it("accepts a run that used every tool call the turn cap allows", () => {
    const result = AgentRunResultSchema.parse({
      response: "Done.",
      artifacts: [],
      executions: Array.from({ length: 1_280 }, () => execution("print(1)")),
      guestExecutions: 1_280,
      inference: generated("Done.").performance,
    });

    expect(result.executions).toHaveLength(1_280);
    expect(result.guestExecutions).toBe(1_280);
  });
});

describe("ChatAgentLoop output limit", () => {
  it("rejects a truncated no-tool answer instead of storing it as success", async () => {
    const truncated = { ...generated("Partial answer"), stopReason: "maxTokens" as const };
    const loop = new ChatAgentLoop(model([truncated], []));

    await expect(
      loop.run(
        input(
          {
            async execute() {
              throw new Error("execution_should_not_start");
            },
          },
          [],
        ),
      ),
    ).rejects.toThrow("agent_generation_limit");
  });
});

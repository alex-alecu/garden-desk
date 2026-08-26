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
      "  File \".vault-tools/test.py\", line 1\n    if True print('broken')\n            ^^^^^\nSyntaxError: invalid syntax";
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

describe("ChatAgentLoop doom loop", () => {
  it("blocks a third identical call and tells the model to change approach", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const calls = ["call-1", "call-2", "call-3"].map((id) =>
      generated("", [tool("list", id, { path: "/source" })]),
    );
    const inspected: string[] = [];
    const loop = new ChatAgentLoop(model([...calls, generated("Changed approach.")], requests));

    await loop.run(
      input(
        {
          async execute(run) {
            inspected.push(source(run));
            return execution(source(run));
          },
          async inspect(run) {
            inspected.push(source(run));
            return execution(source(run));
          },
        },
        ["list"],
      ),
    );

    expect(inspected).toHaveLength(2);
    expect(requests[3]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          text: expect.stringContaining("same tool call has repeated three times"),
        }),
      ]),
    );
  });
});

describe("ChatAgentLoop guest execution budget", () => {
  it("does not charge invalid calls before one valid execution", async () => {
    const invalid = Array.from({ length: 24 }, (_, index) =>
      tool("python", `invalid-${index}`, { source: index }),
    );
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [...invalid, tool("python", "valid", { source: "print('valid')" })]),
          generated("Done."),
        ],
        requests,
      ),
    );
    const executed: string[] = [];
    const events: string[] = [];

    const result = await loop.run(
      input(
        {
          async execute(run) {
            executed.push(source(run));
            return execution(source(run));
          },
        },
        ["python"],
        { onEvent: (type) => events.push(type) },
      ),
    );

    expect(result.response).toBe("Done.");
    expect(executed).toEqual(["print('valid')"]);
    expect(events.filter((type) => type === "execution.started")).toHaveLength(1);
    expect(events.filter((type) => type === "execution.completed")).toHaveLength(1);
  });
});

describe("ChatAgentLoop path preparation budget", () => {
  it("does not charge path preparation failures or emit false execution starts", async () => {
    const missing = Array.from({ length: 24 }, (_, index) =>
      tool("python", `missing-${index}`, { path: `steps/missing-${index}.py` }),
    );
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [...missing, tool("python", "valid", { source: "print('valid')" })]),
          generated("Done."),
        ],
        requests,
      ),
    );
    const executed: string[] = [];
    const events: string[] = [];

    const result = await loop.run(
      input(
        {
          async execute(run) {
            if (run.language !== "shell" && run.source === undefined) {
              throw new Error("agent_script_missing");
            }
            executed.push(source(run));
            return execution(source(run));
          },
        },
        ["python"],
        { onEvent: (type) => events.push(type) },
      ),
    );

    expect(result.response).toBe("Done.");
    expect(executed).toEqual(["print('valid')"]);
    expect(events.filter((type) => type === "execution.started")).toHaveLength(1);
    expect(events.filter((type) => type === "execution.completed")).toHaveLength(1);
  });
});

it("does not infer required artifacts from task text", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(model([generated("The requested work is complete.")], requests));

  const result = await loop.run(
    input(
      {
        async execute() {
          throw new Error("unused");
        },
      },
      ["python"],
      { task: "Create required-result.unknown." },
    ),
  );

  expect(result.response).toBe("The requested work is complete.");
  expect(result.artifacts).toEqual([]);
});

it("retries an output limit without compacting or removing tools", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const limited = { ...generated("partial table"), stopReason: "maxTokens" as const };
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [tool("python", "call-1", { source: "print('evidence')" })]),
        limited,
        generated("Complete table."),
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

  expect(result.response).toBe("Complete table.");
  expect(requests).toHaveLength(3);
  expect(requests[2]?.tools).toHaveLength(1);
  expect(requests[2]?.maxTokens).toBe(4_096);
  expect(requests[2]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "system",
        text: expect.stringContaining("previous turn reached its output limit"),
      }),
    ]),
  );
});

it("compacts output-limit recovery only under real context pressure", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const limited = { ...generated("partial", [], 7_000), stopReason: "maxTokens" as const };
  const loop = new ChatAgentLoop(
    model([limited, generated("Retained facts."), generated("Complete answer.")], requests),
  );

  const result = await loop.run(
    input(
      {
        async execute() {
          throw new Error("unused");
        },
      },
      ["question"],
    ),
  );

  expect(result.response).toBe("Complete answer.");
  expect(requests[1]).toMatchObject({ tools: [], maxTokens: 2_048 });
  expect(requests[2]?.tools).toHaveLength(1);
});

it("stops after a second output-limit failure", async () => {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const limited = { ...generated("partial"), stopReason: "maxTokens" as const };
  const loop = new ChatAgentLoop(model([limited, limited], requests));

  await expect(
    loop.run(
      input(
        {
          async execute() {
            throw new Error("unused");
          },
        },
        ["question"],
      ),
    ),
  ).rejects.toThrow("agent_generation_limit");
  expect(requests).toHaveLength(2);
  expect(requests[1]?.tools).toHaveLength(1);
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

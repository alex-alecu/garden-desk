import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

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
    expect(requests[0]?.maxTokens).toBe(2_048);
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

describe("ChatAgentLoop bounded final response", () => {
  it("discards a max-token response and regenerates one complete response without tools", async () => {
    const requests: Parameters<InferenceService["chat"]>[0][] = [];
    const limited = { ...generated("partial table"), stopReason: "maxTokens" as const };
    const loop = new ChatAgentLoop(
      model(
        [
          generated("", [tool("python", "call-1", { source: "print('evidence')" })]),
          limited,
          generated("Compact evidence."),
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
    expect(requests[2]).toMatchObject({ tools: [], maxTokens: 2_048 });
    expect(requests[3]).toMatchObject({ tools: [], maxTokens: 4_096 });
    expect(requests[3]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          text: expect.stringContaining("previous answer hit its output limit"),
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

    expect(requests[0]).toMatchObject({ contextSize: "auto", maxTokens: 2_048 });
    expect(requests[1]).toMatchObject({ contextSize: "auto", maxTokens: 8_192 });
  });
});

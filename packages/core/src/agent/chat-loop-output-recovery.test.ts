import { describe, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, model, source, tool } from "./chat-loop-test-support.js";

describe("ChatAgentLoop completion", () => {
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
      {
        history: {
          messages: [
            { role: "user", content: "Older request." },
            { role: "assistant", content: "Older retained turn." },
            { role: "user", content: "Recent request." },
            { role: "assistant", content: "Recent retained turn." },
          ],
        },
      },
    ),
  );
  expect(result.response).toBe("Complete answer.");
  expect(requests[1]).toMatchObject({ tools: [], maxTokens: 2_048 });
  expect(requests[2]?.tools).toHaveLength(1);
  expect(requests[2]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "Older retained turn." }),
      expect.objectContaining({ role: "assistant", text: "Recent retained turn." }),
    ]),
  );
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

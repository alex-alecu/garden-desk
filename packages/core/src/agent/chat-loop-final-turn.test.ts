import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { generated, input, model, tool } from "./chat-loop-test-support.js";

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

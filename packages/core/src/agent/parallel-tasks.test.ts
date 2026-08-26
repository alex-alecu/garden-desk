import type { ChatToolCall } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { executeToolCalls, initialToolState } from "./chat-tool-turn.js";
import type { AgentToolResult, GenericToolRegistry } from "./generic-tools.js";

function taskCall(id: string, description: string): ChatToolCall {
  return { id, name: "task", params: { description, prompt: "go", subagent_type: "explore" } };
}

describe("parallel sub-agent execution", () => {
  it("runs consecutive task calls concurrently and folds results in call order", async () => {
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    const registry = {
      validate() {
        return undefined;
      },
      async execute(_name: string, params: unknown): Promise<AgentToolResult> {
        active += 1;
        peak = Math.max(peak, active);
        const description = (params as { description: string }).description;
        await new Promise((accept) => setTimeout(accept, description === "first" ? 15 : 2));
        active -= 1;
        order.push(description);
        return { content: `<task_result>${description}</task_result>`, failed: false };
      },
    } as unknown as GenericToolRegistry;
    const state = initialToolState([]);
    await executeToolCalls({ registry, state }, [taskCall("a", "first"), taskCall("b", "second")]);
    // Both ran at once (second finished first), proving overlap...
    expect(peak).toBe(2);
    expect(order).toEqual(["second", "first"]);
    // ...yet the conversation records their results in the original call order.
    const toolResults = state.messages.filter((message) => message.role === "tool");
    expect(toolResults.map((message) => message.toolCallId)).toEqual(["a", "b"]);
  });

  it("runs a lone task call without the concurrent path", async () => {
    const registry = {
      validate() {
        return undefined;
      },
      async execute(): Promise<AgentToolResult> {
        return { content: "<task_result>only</task_result>", failed: false };
      },
    } as unknown as GenericToolRegistry;
    const state = initialToolState([]);
    await executeToolCalls({ registry, state }, [taskCall("solo", "only")]);
    expect(state.messages.filter((message) => message.role === "tool")).toHaveLength(1);
  });
});

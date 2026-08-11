import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { execution, source } from "./chat-loop-test-support.js";
import { GenericToolRegistry } from "./generic-tools.js";

describe("GenericToolRegistry task", () => {
  it("returns only the injected subagent final report inside the task-result boundary", async () => {
    const requests: unknown[] = [];
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          return execution(source(run));
        },
      },
      skills: { metadata: () => [], read: () => "" },
      async spawnTask(request) {
        requests.push(request);
        return "Only this final report returns.";
      },
    });

    const result = await registry.execute("task", {
      description: "Inspect files",
      prompt: "Find the entrypoint",
      subagent_type: "explore",
    });

    expect(requests).toEqual([
      { description: "Inspect files", prompt: "Find the entrypoint", subagentType: "explore" },
    ]);
    expect(result).toMatchObject({
      failed: false,
      content: "<task_result>\nOnly this final report returns.\n</task_result>",
    });
  });
});

describe("GenericToolRegistry resilient parameters", () => {
  it("assigns code paths internally and bounds oversized inspection ranges", async () => {
    const runs: Parameters<AgentExecutor["execute"]>[0][] = [];
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          runs.push(run);
          return execution(source(run));
        },
        async inspect(run) {
          runs.push(run);
          return execution(source(run));
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    const python = registry.definitions(["python"])[0];
    expect(python?.params).not.toHaveProperty("properties.path");
    await registry.execute("python", { source: "print('ok')", path: "/workspace/bad.py" });
    await registry.execute("list", { path: "/source", depth: 5_000_000_000_000_000 });

    expect(runs[0]).toMatchObject({
      language: "python",
      path: expect.stringMatching(/^\.vault-tools\//u),
    });
    expect(source(runs[1] as (typeof runs)[number])).toContain('\\"depth\\":8');
  });

  it("rejects an unknown tool named by a Markdown agent", () => {
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          return execution(source(run));
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    expect(() => registry.definitions(["read", "unknown"])).toThrow("Unknown agent tool: unknown");
  });
});

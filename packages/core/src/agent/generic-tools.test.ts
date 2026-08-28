import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { execution, source } from "./chat-loop-test-support.js";
import { GenericToolRegistry } from "./generic-tools.js";

const executorOnly: AgentExecutor = {
  async execute(run) {
    return execution(source(run));
  },
};

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

  it("accepts the general work sub-agent type", async () => {
    const requests: unknown[] = [];
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async spawnTask(request) {
        requests.push(request);
        return "Candidate checked.";
      },
    });

    const result = await registry.execute("task", {
      description: "Prepare candidate",
      prompt: "Complete and verify one work unit.",
      subagent_type: "general",
    });

    expect(requests).toEqual([
      {
        description: "Prepare candidate",
        prompt: "Complete and verify one work unit.",
        subagentType: "general",
      },
    ]);
    expect(result.failed).toBe(false);
  });
});

describe("GenericToolRegistry parsing", () => {
  it("parses a direct tool call once", async () => {
    let commandReads = 0;
    const params = Object.defineProperty({}, "command", {
      enumerable: true,
      get: () => {
        commandReads += 1;
        return "printf ok";
      },
    });
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
    });

    await registry.execute("bash", params);

    expect(commandReads).toBe(1);
  });
});

describe("GenericToolRegistry resilient parameters", () => {
  it("supports source-only, saved-source, and committed-path code runs", async () => {
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
    expect(python?.params).toMatchObject({
      properties: {
        source: { type: "string" },
        path: {
          type: "string",
          description: "Relative path, /workspace/..., or path-only /source/....",
        },
      },
      required: [],
    });
    await registry.execute("python", { source: "print('once')" });
    await registry.execute("python", { source: "print('saved')", path: "steps/saved.py" });
    await registry.execute("python", { path: "steps/saved.py" });

    expect(runs[0]).toMatchObject({
      language: "python",
      path: expect.stringMatching(/^\.vault-tools\//u),
      source: "print('once')",
    });
    expect(runs[1]).toEqual({
      language: "python",
      path: "steps/saved.py",
      source: "print('saved')",
    });
    expect(runs[2]).toEqual({ language: "python", path: "steps/saved.py" });
  });
});

describe("GenericToolRegistry saved-script validation", () => {
  it("rejects missing and unsafe script inputs", async () => {
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          return execution(source(run));
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    const missing = await registry.execute("python", {});
    const unsafe = await registry.execute("python", { path: "../bad.py" });

    expect(missing).toMatchObject({ failed: true, invalidInput: true });
    expect(unsafe).toMatchObject({ failed: true, invalidInput: true });
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

  it("does not convert cancellation into a tool result", async () => {
    const cancelled = new DOMException("Stopped.", "AbortError");
    const registry = new GenericToolRegistry({
      executor: {
        async execute() {
          throw cancelled;
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    await expect(registry.execute("python", { source: "print('work')" })).rejects.toBe(cancelled);
  });
});

describe("GenericToolRegistry bounded integers", () => {
  it("clamps safe integers and rejects unsafe numeric values", async () => {
    const runs: Parameters<AgentExecutor["execute"]>[0][] = [];
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          return execution(source(run));
        },
        async inspect(run) {
          runs.push(run);
          return execution(source(run));
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    await registry.execute("list", { path: "/source", depth: -50 });
    await registry.execute("list", { path: "/source", depth: 5_000_000_000_000_000 });
    const fraction = await registry.execute("list", { path: "/source", depth: 1.5 });
    const infinite = await registry.execute("list", { path: "/source", depth: Infinity });
    const unsafe = await registry.execute("list", {
      path: "/source",
      depth: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(source(runs[0] as (typeof runs)[number])).toContain('\\"depth\\":0');
    expect(source(runs[1] as (typeof runs)[number])).toContain('\\"depth\\":8');
    expect(fraction).toMatchObject({ failed: true, invalidInput: true });
    expect(infinite).toMatchObject({ failed: true, invalidInput: true });
    expect(unsafe).toMatchObject({ failed: true, invalidInput: true });
  });
});

describe("GenericToolRegistry invalid input", () => {
  it("distinguishes invalid input from a valid failed execution", async () => {
    const registry = new GenericToolRegistry({
      executor: {
        async execute(run) {
          return execution(source(run), "failed", 1);
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    await expect(registry.execute("unknown", {})).resolves.toMatchObject({
      failed: true,
      invalidInput: true,
    });
    await expect(registry.execute("python", {})).resolves.toMatchObject({
      failed: true,
      invalidInput: true,
    });
    const failedExecution = await registry.execute("python", { source: "raise SystemExit(1)" });
    expect(failedExecution).toMatchObject({ failed: true });
    expect(failedExecution).not.toHaveProperty("invalidInput");
  });
});

import { describe, expect, it } from "vitest";
import type { AgentExecutor } from "./agent-executor.js";
import { execution, source } from "./chat-loop-test-support.js";
import type { AgentQuestionOutcome } from "./generic-tool-support.js";
import { GenericToolRegistry } from "./generic-tools.js";

const executorOnly: AgentExecutor = {
  async execute(run) {
    return execution(source(run));
  },
};

const singleQuestion = [
  {
    header: "Direction",
    question: "Which output do you want?",
    options: [
      { label: "Summary (Recommended)", description: "A short recap." },
      { label: "Full report", description: "Every detail." },
    ],
  },
];

describe("GenericToolRegistry question", () => {
  it("resolves with the selected labels and continues the run", async () => {
    const asked: unknown[] = [];
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async askQuestion(questions): Promise<AgentQuestionOutcome> {
        asked.push(questions);
        return { dismissed: false, answers: [["Full report"]] };
      },
    });

    const result = await registry.execute("question", { questions: singleQuestion });

    expect(asked).toHaveLength(1);
    expect(result.failed).toBe(false);
    expect(result.content).toContain("Full report");
    expect(result.execution).toBeUndefined();
  });

  it("serializes custom answer punctuation without corrupting the tool result", async () => {
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async askQuestion(): Promise<AgentQuestionOutcome> {
        return { dismissed: false, answers: [['Use "quoted"\ntext']] };
      },
    });

    const result = await registry.execute("question", { questions: singleQuestion });

    expect(result.content).toContain('="Use \\"quoted\\"\\ntext"');
  });

  it("treats a dismissal as a non-failing proceed-anyway result", async () => {
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async askQuestion(): Promise<AgentQuestionOutcome> {
        return { dismissed: true };
      },
    });

    const result = await registry.execute("question", { questions: singleQuestion });

    expect(result.failed).toBe(false);
    expect(result.content).toContain("best judgment");
  });

  it("reports the tool as unavailable when no question channel is wired", async () => {
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
    });

    const result = await registry.execute("question", { questions: singleQuestion });

    expect(result).toMatchObject({
      failed: true,
      content: "Questions are unavailable from this agent.",
    });
  });
});

describe("GenericToolRegistry question validation", () => {
  it("keeps the model-facing schema flat while enforcing the full runtime contract", () => {
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
    });

    const question = registry.definitions(["question"])[0];
    expect(question?.params).toMatchObject({
      properties: { questions: { type: "string" } },
    });
    expect(question?.params).not.toHaveProperty(
      "properties.questions.items.properties.options.items.properties",
    );
  });

  it("accepts the model-facing JSON encoding", async () => {
    const asked: unknown[] = [];
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async askQuestion(questions): Promise<AgentQuestionOutcome> {
        asked.push(questions);
        return { dismissed: true };
      },
    });

    const result = await registry.execute("question", {
      questions: JSON.stringify(singleQuestion),
    });

    expect(result.failed).toBe(false);
    expect(asked).toEqual([singleQuestion]);
  });

  it("rejects malformed question input before reaching the channel", async () => {
    let called = false;
    const registry = new GenericToolRegistry({
      executor: executorOnly,
      skills: { metadata: () => [], read: () => "" },
      async askQuestion(): Promise<AgentQuestionOutcome> {
        called = true;
        return { dismissed: true };
      },
    });

    const result = await registry.execute("question", {
      questions: [{ header: "Bad", question: "One option only?", options: [{ label: "Only" }] }],
    });

    expect(called).toBe(false);
    expect(result.failed).toBe(true);
  });
});

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

describe("GenericToolRegistry resilient parameters", () => {
  it("assigns code paths internally and rejects oversized inspection ranges", async () => {
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
    const invalidDepth = await registry.execute("list", {
      path: "/source",
      depth: 5_000_000_000_000_000,
    });
    await registry.execute("list", { path: "/run/attachments", depth: 1 });

    expect(runs[0]).toMatchObject({
      language: "python",
      path: expect.stringMatching(/^\.vault-tools\//u),
    });
    expect(invalidDepth).toMatchObject({ failed: true, invalidInput: true });
    expect(runs).toHaveLength(2);
    expect(source(runs[1] as (typeof runs)[number])).toContain("Path('/run/attachments')");
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

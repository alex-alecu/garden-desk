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
    expect(question?.params).toMatchObject({ properties: { questions: { type: "string" } } });
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

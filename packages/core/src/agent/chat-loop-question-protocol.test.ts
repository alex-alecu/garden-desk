import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { generated, input, model, tool } from "./chat-loop-test-support.js";

const unusedExecutor = {
  async execute() {
    throw new Error("unused");
  },
};

it("recovers a valid question before the saved leaked tool suffix", async () => {
  const asked: unknown[] = [];
  const questions = [
    {
      header: "Favorite Fruit",
      question: "What is your favorite fruit?",
      options: [
        { label: "Apple (Recommended)", description: "A classic, crunchy choice." },
        { label: "Banana", description: "A popular, potassium-rich snack." },
      ],
    },
  ];
  const leaked = `${JSON.stringify(questions)}}}<tool_call|><tool_call|><|channel>thought:<channel|>Wait for the user.`;
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [tool("question", "call_msrq3x7i_3", { questions: leaked })]),
        generated("Apple is your favorite fruit."),
      ],
      requests,
    ),
  );

  const result = await loop.run(
    input(unusedExecutor, ["question"], {
      async askQuestion(value) {
        asked.push(value);
        return { dismissed: false, answers: [["Apple"]] };
      },
    }),
  );

  expect(asked).toEqual([questions]);
  expect(result.response).toBe("Apple is your favorite fruit.");
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "assistant",
        toolCalls: [
          expect.objectContaining({
            id: "call_msrq3x7i_3",
            params: { questions: JSON.stringify(questions) },
          }),
        ],
      }),
    ]),
  );
});

it("keeps the question tool after a low-context output-limit recovery", async () => {
  const asked: unknown[] = [];
  const events: string[] = [];
  const questions = [
    {
      header: "Favorite Fruit",
      question: "What is your favorite fruit?",
      options: [
        { label: "Apple (Recommended)", description: "A classic, crunchy fruit." },
        { label: "Banana", description: "A popular yellow fruit." },
      ],
    },
  ];
  const limited = generated("", [], 1_100);
  limited.stopReason = "maxTokens";
  limited.memory.contextSizeTokens = 65_536;
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        limited,
        generated("", [
          tool("question", "call-question", { questions: JSON.stringify(questions) }),
        ]),
        generated("Banana is your favorite fruit."),
      ],
      requests,
    ),
  );

  const result = await loop.run(
    input(unusedExecutor, ["question"], {
      onEvent(_type, summary) {
        events.push(summary);
      },
      async askQuestion(value) {
        asked.push(value);
        return { dismissed: false, answers: [["Banana"]] };
      },
    }),
  );

  expect(result.response).toBe("Banana is your favorite fruit.");
  expect(asked).toEqual([questions]);
  expect(requests[1]?.tools).toHaveLength(1);
  expect(requests[1]?.maxTokens).toBe(16_384);
  expect(events).not.toContain("Condensing the working context.");
});

it("does not recover a protocol transition inside valid question data", async () => {
  let asked = false;
  const questions = [
    {
      header: "Protocol",
      question: "Use </tool_call><|channel> here?",
      options: [{ label: "Yes" }, { label: "No" }],
    },
  ];
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const loop = new ChatAgentLoop(
    model(
      [
        generated("", [
          tool("question", "call-bad-question", { questions: JSON.stringify(questions) }),
        ]),
        generated("No question was shown."),
      ],
      requests,
    ),
  );

  const result = await loop.run(
    input(unusedExecutor, ["question"], {
      async askQuestion() {
        asked = true;
        return { dismissed: true };
      },
    }),
  );

  expect(asked).toBe(false);
  expect(result.response).toBe("No question was shown.");
  expect(requests[1]?.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        toolCallId: "call-bad-question",
        result: expect.stringContaining("protocol-control transition"),
      }),
    ]),
  );
});

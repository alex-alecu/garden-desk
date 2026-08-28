import type { ChatMessage } from "@vault/shared";
import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";

type ChatRequest = Parameters<InferenceService["chat"]>[0];

const badSource = "if True print('broken')";
const fixedSource = "print('recovered')";
const syntaxError = "SyntaxError: invalid syntax";

function pythonCallIds(messages: readonly ChatMessage[], value: string): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? message.toolCalls
          .filter((call) => (call.params as { source?: string }).source === value)
          .map((call) => call.id)
      : [],
  );
}

function userDirections(messages: readonly ChatMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "user" && message.text.startsWith("Latest user direction")
      ? [message.text]
      : [],
  );
}

function repeatingModel(requests: ChatRequest[]): ChatAgentLoop {
  const results = [
    ...Array.from({ length: 7 }, (_, index) =>
      generated(
        index < 2 ? "" : "Trying the same action again.",
        [tool("python", `bad-${index + 1}`, { source: badSource })],
        index === 6 ? 6_554 : 1,
      ),
    ),
    generated("", [tool("python", "fixed", { source: fixedSource })]),
    generated("Recovered."),
  ];
  return new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      if (request.tools.length === 0) return generated("Summary.");
      const result = results.shift();
      if (result === undefined) throw new Error("Missing chat result.");
      return result;
    },
  });
}

it("blocks a repeated failing call, keeps one copy in prompts, and asks for direction", async () => {
  const requests: ChatRequest[] = [];
  const executed: string[] = [];
  const askedAt: number[] = [];
  const result = await repeatingModel(requests).run(
    input(
      {
        async execute(run) {
          executed.push(source(run));
          return source(run) === badSource
            ? execution(badSource, syntaxError, 1)
            : execution(fixedSource);
        },
      },
      ["python"],
      {
        async askQuestion(questions) {
          expect(questions[0]?.header).toBe("Repeated action");
          askedAt.push(requests.filter((request) => request.tools.length > 0).length);
          return askedAt.length === 1
            ? { dismissed: false, answers: [["Inspect first"]] }
            : { dismissed: true };
        },
      },
    ),
  );
  const chat = requests.filter((request) => request.tools.length > 0);
  const compaction = requests.find((request) => request.tools.length === 0);

  expect(result.response).toBe("Recovered.");
  expect(executed).toEqual([badSource, badSource, fixedSource]);
  expect(askedAt).toEqual([5, 7]);
  for (const index of [3, 4, 5, 6, 7]) {
    const messages = chat[index]?.messages ?? [];
    expect(pythonCallIds(messages, badSource)).toEqual(["bad-2"]);
    expect(
      messages.filter((m) => m.role === "tool" && m.result.includes(syntaxError)),
    ).toHaveLength(1);
  }
  expect(userDirections(chat[5]?.messages ?? [])).toEqual([
    expect.stringContaining("Inspect first"),
  ]);
  expect(userDirections(chat[7]?.messages ?? [])).toEqual([
    expect.stringContaining("Inspect current state before another execution."),
  ]);
  expect(userDirections(chat[8]?.messages ?? [])).toEqual([]);
  expect(JSON.stringify(compaction?.messages)).not.toContain("The repeated action is blocked");
});

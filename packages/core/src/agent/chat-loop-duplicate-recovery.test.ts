import type { ChatGenerationResult, ChatMessage } from "@vault/shared";
import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";
import type { AgentQuestionOutcome } from "./generic-tool-support.js";

type ChatRequest = Parameters<InferenceService["chat"]>[0];

const badSource = "if True print('broken')";
const fixedSource = "print('recovered')";
const syntaxError = "SyntaxError: invalid syntax";

function badCall(index: number): ChatGenerationResult {
  return generated(
    index < 2 ? "" : "Trying the same action again.",
    [tool("python", `bad-${index + 1}`, { source: badSource })],
    index === 5 ? 6_554 : 1,
  );
}

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

function runScenario(results: ChatGenerationResult[], answer: AgentQuestionOutcome) {
  const requests: ChatRequest[] = [];
  const executed: string[] = [];
  const askedAt: number[] = [];
  const loop = new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      if (request.tools.length === 0) return generated("Summary.");
      const result = results.shift();
      if (result === undefined) throw new Error("Missing chat result.");
      return result;
    },
  });
  const run = loop.run(
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
          return answer;
        },
      },
    ),
  );
  const chat = () => requests.filter((request) => request.tools.length > 0);
  return { askedAt, chat, executed, requests, run };
}

it("blocks a repeated failing call, keeps one copy in prompts, and recovers after direction", async () => {
  const bad = Array.from({ length: 6 }, (_, index) => badCall(index));
  const scenario = runScenario(
    [
      ...bad,
      generated("", [tool("python", "fixed", { source: fixedSource })]),
      generated("Recovered."),
    ],
    { dismissed: false, answers: [["Inspect first"]] },
  );
  const result = await scenario.run;
  const chat = scenario.chat();

  expect(result.response).toBe("Recovered.");
  expect(scenario.executed).toEqual([badSource, badSource, fixedSource]);
  expect(scenario.askedAt).toEqual([5]);
  for (const index of [3, 4, 5, 6]) {
    const messages = chat[index]?.messages ?? [];
    expect(pythonCallIds(messages, badSource)).toEqual(["bad-2"]);
    expect(
      messages.filter((m) => m.role === "tool" && m.result.includes(syntaxError)),
    ).toHaveLength(1);
  }
  expect(userDirections(chat[5]?.messages ?? [])).toEqual([
    expect.stringContaining("Inspect first"),
  ]);
  expect(userDirections(chat[7]?.messages ?? [])).toEqual([]);
  const compaction = scenario.requests.find((request) => request.tools.length === 0);
  expect(JSON.stringify(compaction?.messages)).not.toContain("The repeated action is blocked");
});

it("stops the run when the model ignores the recovery direction", async () => {
  const scenario = runScenario(
    Array.from({ length: 7 }, (_, index) => badCall(index)),
    { dismissed: true },
  );
  await expect(scenario.run).rejects.toThrow("agent_stalled_duplicate");
  expect(scenario.executed).toEqual([badSource, badSource]);
  expect(scenario.askedAt).toEqual([5]);
  expect(userDirections(scenario.chat()[5]?.messages ?? [])).toEqual([
    expect.stringContaining("Inspect current state before another execution."),
  ]);
});

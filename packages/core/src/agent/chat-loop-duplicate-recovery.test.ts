import type { ChatMessage } from "@vault/shared";
import { expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";

const badSource = "if True print('broken')";
const fixedSource = "print('recovered')";
const syntaxError = [
  '  File ".vault-tools/test.py", line 1',
  "    if True print('broken')",
  "            ^^^^^",
  "SyntaxError: invalid syntax",
].join("\n");

const repeatedQuestion = [
  {
    header: "Repeated action",
    question:
      "The same action is still repeated after automatic recovery. How should Vault Desk continue?",
    options: [
      {
        label: "Inspect first (Recommended)",
        description: "Use a different inspection action before another execution.",
      },
      {
        label: "Change method",
        description: "Use another available tool or different input.",
      },
    ],
  },
];

function callsWithSource(messages: readonly ChatMessage[], value: string) {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? message.toolCalls.filter(
          (call) =>
            call.name === "python" &&
            typeof call.params === "object" &&
            call.params !== null &&
            (call.params as Record<string, unknown>).source === value,
        )
      : [],
  );
}

function failedPythonResults(messages: readonly ChatMessage[]) {
  return messages.filter(
    (message) =>
      message.role === "tool" &&
      message.name === "python" &&
      message.result.includes("SyntaxError: invalid syntax"),
  );
}

function recoveryLoop(requests: Parameters<InferenceService["chat"]>[0][]) {
  const repeatedCalls = Array.from({ length: 7 }, (_, index) =>
    generated(
      index < 2 ? "" : "Trying the same action again.",
      [tool("python", `bad-${index + 1}`, { source: badSource })],
      index === 6 ? 6_554 : 1,
    ),
  );
  const results = [
    ...repeatedCalls,
    generated("", [tool("python", "fixed", { source: fixedSource })]),
    generated("Recovered."),
  ];
  return new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      if (request.tools.length === 0) return generated("Keep the current recovery evidence.");
      const result = results.shift();
      if (result === undefined) throw new Error("Missing chat result.");
      return result;
    },
  });
}

function chatRequests(requests: Parameters<InferenceService["chat"]>[0][]) {
  return requests.filter((request) => request.tools.length > 0);
}

async function runRecoveryFixture() {
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const executed: string[] = [];
  const asked: unknown[] = [];
  const askedAt: number[] = [];
  const result = await recoveryLoop(requests).run(
    input(
      {
        async execute(run) {
          const program = source(run);
          executed.push(program);
          return program === badSource ? execution(program, syntaxError, 1) : execution(program);
        },
      },
      ["python"],
      {
        async askQuestion(questions) {
          asked.push(questions);
          askedAt.push(chatRequests(requests).length);
          return asked.length === 1
            ? { dismissed: false, answers: [["Inspect first"]] }
            : { dismissed: true };
        },
      },
    ),
  );
  return { asked, askedAt, executed, requests, result };
}

function expectExecutionOutcome(fixture: Awaited<ReturnType<typeof runRecoveryFixture>>): void {
  expect(fixture.result.response).toBe("Recovered.");
  expect(fixture.executed).toEqual([badSource, badSource, fixedSource]);
  expect(fixture.result.guestExecutions).toBe(3);
  const failures = fixture.result.executions.filter((item) => item.exitCode === 1);
  expect(failures).toHaveLength(2);
  expect(failures.every((item) => item.stderr === syntaxError)).toBe(true);
  expect(fixture.asked).toEqual([repeatedQuestion, repeatedQuestion]);
  expect(fixture.askedAt).toEqual([5, 7]);
}

function expectCleanRecoveryPrompts(requests: Parameters<InferenceService["chat"]>[0][]): void {
  const chat = chatRequests(requests);
  for (const requestIndex of [3, 4, 5, 6, 7]) {
    const messages = chat[requestIndex]?.messages ?? [];
    expect(callsWithSource(messages, badSource)).toEqual([
      expect.objectContaining({ id: "bad-2" }),
    ]);
    const results = failedPythonResults(messages);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolCallId: "bad-2" });
    if (results[0]?.role !== "tool") throw new Error("missing_retained_failure");
    expect(results[0].result).toContain("exit_code: 1");
    expect(results[0].result).toContain("termination: completed");
    expect(results[0].result).toContain("stdout: (empty)");
    expect(results[0].result).toContain(`stderr:\n${syntaxError}`);
    expect(messages.filter((message) => message.role === "system")).toHaveLength(2);
  }
}

function expectLatestDirections(requests: Parameters<InferenceService["chat"]>[0][]): void {
  const chat = chatRequests(requests);
  const recoveryDirections = (requestIndex: number) =>
    (chat[requestIndex]?.messages ?? []).filter(
      (message) => message.role === "user" && message.text.startsWith("Latest user direction"),
    );
  const firstDirection = recoveryDirections(5);
  expect(firstDirection).toHaveLength(1);
  expect(firstDirection[0]).toMatchObject({ text: expect.stringContaining("Inspect first") });

  const dismissedDirection = recoveryDirections(7);
  expect(dismissedDirection).toHaveLength(1);
  expect(dismissedDirection[0]).toMatchObject({
    text: expect.stringContaining("Inspect current state before another execution."),
  });
  expect(JSON.stringify(dismissedDirection[0])).not.toContain("Inspect first");
}

function expectRecoveredFinalPrompt(requests: Parameters<InferenceService["chat"]>[0][]): void {
  const finalPrompt = chatRequests(requests)[8]?.messages ?? [];
  expect(finalPrompt.filter((message) => message.role === "system")).toHaveLength(1);
  expect(
    finalPrompt.filter(
      (message) => message.role === "user" && message.text.startsWith("Latest user direction"),
    ),
  ).toHaveLength(0);
  expect(callsWithSource(finalPrompt, fixedSource)).toHaveLength(1);
}

it("recovers a repeated failed action with bounded context and repeatable user direction", async () => {
  const fixture = await runRecoveryFixture();
  expectExecutionOutcome(fixture);
  expectCleanRecoveryPrompts(fixture.requests);
  expectLatestDirections(fixture.requests);
  expectRecoveredFinalPrompt(fixture.requests);
  const compaction = fixture.requests.find((request) => request.tools.length === 0);
  expect(compaction).toBeDefined();
  expect(JSON.stringify(compaction?.messages)).not.toContain("The repeated action is blocked");
  expect(JSON.stringify(compaction?.messages)).not.toContain("Latest user direction");
});

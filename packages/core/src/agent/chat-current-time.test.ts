import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import { currentTimeContext } from "./chat-current-time.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { execution, generated, input, source, tool } from "./chat-loop-test-support.js";

afterEach(() => vi.useRealTimers());

describe("currentTimeContext", () => {
  it("provides exact local and UTC times with the local date rule", () => {
    const context = currentTimeContext(new Date("2026-08-14T12:34:56.789Z"), "Europe/Bucharest");

    expect(context).toBe(
      [
        "Current host date and time:",
        "- Local: 2026-08-14T15:34:56.789+03:00 [Europe/Bucharest]",
        "- UTC: 2026-08-14T12:34:56.789Z",
        "This clock snapshot was made when this model request was prepared. For a value with a time zone, compare the exact instants. For a date without a time or time zone, compare it with the local date above. The same local date is today, not past or future.",
      ].join("\n"),
    );
  });
});

it("refreshes one host clock snapshot for every model request", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T12:34:56.789Z"));
  const requests: Parameters<InferenceService["chat"]>[0][] = [];
  const results = [
    generated("", [tool("python", "call-1", { source: "print(2)" })]),
    generated("Done."),
  ];
  const loop = new ChatAgentLoop({
    async chat(request) {
      requests.push(structuredClone(request));
      const result = results.shift();
      if (result === undefined) throw new Error("Missing chat result.");
      vi.setSystemTime(new Date("2026-08-15T01:02:03.004Z"));
      return result;
    },
  });

  await loop.run(
    input(
      {
        async execute(run) {
          return execution(source(run));
        },
      },
      ["python"],
    ),
  );

  const systemTexts = requests.map((request) => {
    const message = request.messages[0];
    if (message?.role !== "system") throw new Error("Expected the system message.");
    return message.text;
  });
  expect(systemTexts).toHaveLength(2);
  expect(systemTexts[0]).toContain("- UTC: 2026-08-14T12:34:56.789Z");
  expect(systemTexts[1]).toContain("- UTC: 2026-08-15T01:02:03.004Z");
  for (const text of systemTexts) {
    expect(text.split("Current host date and time:")).toHaveLength(2);
  }
});

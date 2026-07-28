import { describe, expect, it } from "vitest";
import { rejectedExecutionReason } from "./loop-decisions.js";

describe("Agent source validation", () => {
  it("rejects model protocol fragments before execution", () => {
    expect(
      rejectedExecutionReason(
        {
          action: "execute",
          language: "node",
          source: "import { readFileSync } from 'node:fs';\n]}}<tool_call|><|channel>thought",
          summary: "Read input",
        },
        [],
      ),
    ).toBe("invalid");
  });

  it("accepts ordinary Node ESM source", () => {
    expect(
      rejectedExecutionReason(
        {
          action: "execute",
          language: "node",
          source: "import { readFileSync } from 'node:fs';\nconsole.log(readFileSync('/source/a'))",
          summary: "Read input",
        },
        [],
      ),
    ).toBeUndefined();
  });
});

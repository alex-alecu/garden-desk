import { describe, expect, it } from "vitest";
import { rejectedExecutionReason } from "./loop-decisions.js";
import { parseAgentDecision } from "./prompt-normalization.js";

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
});

describe("Agent shell interpreter validation", () => {
  it.each([
    "python",
    "python3",
    "python3 -",
    "python3 -q",
    "/usr/bin/python3",
    "node -",
    "node --interactive",
  ])("rejects bare interactive interpreter command %s before execution", (command) => {
    expect(
      rejectedExecutionReason(
        { action: "execute", language: "shell", command, summary: "Run interpreter" },
        [],
      ),
    ).toBe("shell_source");
  });

  it.each([
    "python3 steps/1.py",
    "node steps/1.mjs",
    "python3 --version",
    "node --help",
    "find /source -type f | head",
  ])("accepts complete shell command %s", (command) => {
    expect(
      rejectedExecutionReason(
        { action: "execute", language: "shell", command, summary: "Run command" },
        [],
      ),
    ).toBeUndefined();
  });
});

describe("Agent valid source", () => {
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

  it("strips trailing hallucinated identifier debris so a valid repair is accepted", () => {
    const program = "print('ok')\nif __name__ == '__main__':\n    main()";
    const decision = parseAgentDecision({
      action: "execute",
      language: "python",
      source: [...program.split("\n"), "skills_requested_none", "command_args_none Giants_none"],
      summary: "Repair",
    });
    expect(decision).toMatchObject({ action: "execute", source: program });
    expect(rejectedExecutionReason(decision as never, [])).toBeUndefined();
  });
});

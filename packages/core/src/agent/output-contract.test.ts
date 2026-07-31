import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { executionCompletionSummary } from "./output-contract.js";

function result(
  termination: AgentExecutionResult["termination"],
  exitCode: number,
): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/0001.py",
    source: "print('ok')",
    command: null,
    exitCode,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination,
    artifacts: [],
  };
}

describe("execution completion summary", () => {
  it("keeps successful conversation progress non-technical", () => {
    expect(executionCompletionSummary(result("completed", 0))).toBe("Finished this step.");
  });

  it("describes unsuccessful outcomes without process jargon", () => {
    expect(executionCompletionSummary(result("timeout", 124))).toBe(
      "This step took too long and stopped.",
    );
    expect(executionCompletionSummary(result("cancelled", 130))).toBe("This step was cancelled.");
    expect(executionCompletionSummary(result("crash", 1))).toBe(
      "This step could not be completed.",
    );
  });
});

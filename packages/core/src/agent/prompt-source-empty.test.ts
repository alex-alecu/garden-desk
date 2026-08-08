import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { generationInput } from "./prompt.js";

const emptyExecution: AgentExecutionResult = {
  language: "python",
  path: "steps/search.py",
  source: "print('')",
  command: null,
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 1,
  termination: "completed",
  artifacts: [],
};

describe("empty source inspection recovery", () => {
  it("requires bounded content translation instead of another literal-label search", () => {
    const request = generationInput(
      {
        task: "Inspect this source folder and report SURCHARGE_BPS=<value>.",
        modelId: "test",
      },
      {
        executions: [emptyExecution],
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
        rejectedDuplicates: 0,
      },
    );

    expect(request.prompt).toContain("print its complete bounded content unchanged");
    expect(request.prompt).toContain("do not use another regex");
    expect(request.jsonSchema).not.toHaveProperty("oneOf");
    expect(JSON.stringify(request.jsonSchema)).toContain('"maxItems":40');
  });

  it("allows finalization when an output limit retained useful discovery evidence", () => {
    const request = generationInput(
      { task: "Print a bounded source inspection.", modelId: "test" },
      {
        executions: [
          {
            ...emptyExecution,
            stdout: "limit-start\n",
            termination: "resource_limit",
          },
        ],
        inference: {
          promptTokens: 0,
          outputTokens: 0,
          promptDurationMs: 0,
          generationDurationMs: 0,
          totalDurationMs: 0,
        },
        rejectedDuplicates: 0,
        requestedSkills: new Set(["terminal-commands"]),
      },
    );

    expect(request.jsonSchema).toHaveProperty("oneOf");
    expect(JSON.stringify(request.jsonSchema)).toContain('"const":"respond"');
  });
});

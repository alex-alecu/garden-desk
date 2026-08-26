import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import { GenericToolRegistry } from "./generic-tools.js";
import { GuestExecutionBudget } from "./guest-execution-budget.js";

function completedArtifactExecution(): AgentExecutionResult {
  return {
    language: "python",
    path: "steps/report.py",
    source: "print('large output')",
    command: null,
    exitCode: 0,
    stdout: "x".repeat(60_000),
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [
      {
        name: "report.txt",
        mediaType: "application/octet-stream",
        bytesBase64: Buffer.from("stable artifact").toString("base64"),
      },
    ],
  };
}

describe("GenericToolRegistry output recovery", () => {
  it("refuses a spill before its first chunk when the primary execution used the capacity", async () => {
    const execution = completedArtifactExecution();
    const inspect = vi.fn(async () => {
      throw new Error("spill must not start");
    });
    const registry = new GenericToolRegistry({
      executor: {
        async execute() {
          return execution;
        },
        inspect,
      },
      skills: { metadata: () => [], read: () => "" },
    });

    const result = await registry.execute(
      "python",
      { source: execution.source, path: execution.path },
      new GuestExecutionBudget(1),
    );

    expect(inspect).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      failed: true,
      guestExecutionsStarted: 1,
      outputFailure: "tool_output_spill_budget_exceeded",
      execution,
      content: "Error: tool_output_spill_budget_exceeded",
    });
  });

  it("retains a completed execution when its output spill fails", async () => {
    const execution = completedArtifactExecution();
    const registry = new GenericToolRegistry({
      executor: {
        async execute() {
          return execution;
        },
        async inspect() {
          throw new Error("spill boundary failed");
        },
      },
      skills: { metadata: () => [], read: () => "" },
    });

    const result = await registry.execute("python", {
      source: execution.source,
      path: execution.path,
    });

    expect(result).toMatchObject({
      failed: true,
      guestExecutionsStarted: 2,
      execution,
      content: "Error: spill boundary failed",
    });
  });
});

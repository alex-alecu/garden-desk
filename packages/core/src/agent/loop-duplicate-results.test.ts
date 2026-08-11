import type { AgentDecision } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { AgentLoop } from "./loop.js";
import { completed, executor, inference } from "./loop-xlsx-test-support.js";

describe("AgentLoop duplicate decisions", () => {
  it("does not execute a program again after it already succeeded", async () => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const nextCode = "print('next')";
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: completed.source ?? "", summary: "Step 1" },
      { action: "execute", language: "python", source: completed.source ?? "", summary: "Repeat" },
      { action: "execute", language: "python", source: nextCode, summary: "Step 2" },
      { action: "respond", response: "Done." },
    ];
    const second = { ...completed, source: nextCode, stdout: "next\n" };
    const result = await new AgentLoop(
      inference(decisions, prompts),
      executor([{ ...completed }, second], calls),
    ).run({ task: "Complete two steps", modelId: "test-model" });

    expect(calls).toEqual([completed.source ?? "", nextCode]);
    expect(result.executions).toEqual([completed, second]);
    expect(prompts[2]).toContain("Rejected duplicate or pathologically repetitive programs: 1.");
  });

  it("does not spend another execution on an unchanged failed program", async () => {
    const calls: string[] = [];
    const prompts: string[] = [];
    const failed = {
      ...completed,
      exitCode: 1,
      stderr: "SyntaxError",
      termination: "crash" as const,
    };
    const repaired = { ...completed, source: "print('repaired')" };
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: failed.source ?? "", summary: "Try" },
      { action: "execute", language: "python", source: failed.source ?? "", summary: "Repeat" },
      { action: "execute", language: "python", source: repaired.source ?? "", summary: "Repair" },
      { action: "respond", response: "Done." },
    ];
    const result = await new AgentLoop(
      inference(decisions, prompts),
      executor([failed, repaired], calls),
    ).run({ task: "Inspect input", modelId: "test-model" });

    expect(calls).toEqual([failed.source, repaired.source]);
    expect(result.executions).toEqual([failed, repaired]);
    expect(prompts[2]).toContain("Rejected duplicate or pathologically repetitive programs: 1.");
  });
});

import { randomUUID } from "node:crypto";
import {
  type AgentEvent,
  AgentEventSchema,
  AgentExecutionResultSchema,
  AgentWorkspacePathSchema,
  type ConversationMessage,
  ConversationMessageSchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { assembleHistory } from "./history.js";
import { generationInput } from "./prompt.js";

function message(role: "user" | "assistant", content: string): ConversationMessage {
  return ConversationMessageSchema.parse({
    id: randomUUID(),
    sessionId: randomUUID(),
    role,
    content,
    runId: null,
    createdAt: new Date().toISOString(),
  });
}

function event(source: string, stderr: string, exitCode = 1): AgentEvent {
  return AgentEventSchema.parse({
    id: randomUUID(),
    runId: randomUUID(),
    sequence: 0,
    type: "execution.completed",
    summary: exitCode === 0 ? "Finished this step." : "This step could not be completed.",
    language: "python",
    path: "steps/0001.py",
    source,
    command: null,
    exitCode,
    stdout: "",
    stderr,
    termination: exitCode === 0 ? "completed" : "crash",
    createdAt: new Date().toISOString(),
  });
}

function emptyInference() {
  return {
    promptTokens: 0,
    outputTokens: 0,
    promptDurationMs: 0,
    generationDurationMs: 0,
    totalDurationMs: 0,
  };
}

describe("agent workspace paths", () => {
  it("accepts safe relative paths and rejects traversal", () => {
    expect(AgentWorkspacePathSchema.parse("steps/0001.py")).toBe("steps/0001.py");
    for (const path of ["/tmp/a", "../a", "a/../b", "a\\b", "a//b", "./a", "a\0b"]) {
      expect(AgentWorkspacePathSchema.safeParse(path).success).toBe(false);
    }
  });

  it("keeps source and shell execution results as distinct shapes", () => {
    const evidence = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      termination: "completed" as const,
      artifacts: [],
    };
    expect(
      AgentExecutionResultSchema.safeParse({
        ...evidence,
        language: "python",
        path: "steps/0001.py",
        source: "print('ok')",
        command: null,
      }).success,
    ).toBe(true);
    expect(
      AgentExecutionResultSchema.safeParse({
        ...evidence,
        language: "shell",
        path: "steps/0001.sh",
        source: null,
        command: "true",
      }).success,
    ).toBe(false);
  });
});

describe("agent history compaction", () => {
  it("keeps the newest failed repair chain and the last two user turns", () => {
    const failed = event("print(missing)", "NameError: missing");
    const history = assembleHistory(
      {
        messages: [
          message("user", "first task"),
          message("assistant", "first result"),
          message("user", "second task"),
          message("assistant", "second result"),
          message("user", "repair it"),
        ],
        runs: [{ state: "failed", events: [failed] }],
      },
      3_000,
    );
    expect(history).toContain("print(missing)");
    expect(history).toContain("NameError: missing");
    expect(history).toContain("user: first task");
    expect(history).toContain("Older conversation summary");
    expect(history).toContain("user: second task");
    expect(history).toContain("user: repair it");
  });
});

describe("agent context exhaustion", () => {
  it("keeps the complete serialized request inside the context remainder", () => {
    const request = generationInput(
      { task: "Inspect", modelId: "test", history: { messages: [], runs: [] } },
      { executions: [], inference: emptyInference(), rejectedDuplicates: 0 },
    );
    expect(Math.ceil(JSON.stringify(request).length / 4)).toBeLessThanOrEqual(4_096);
  });

  it("returns context exhausted instead of dropping mandatory current repair source", () => {
    expect(() =>
      generationInput(
        { task: "Repair", modelId: "test" },
        {
          executions: [
            {
              language: "python",
              path: "steps/0001.py",
              source: "x".repeat(20_000),
              command: null,
              exitCode: 1,
              stdout: "",
              stderr: "SyntaxError",
              durationMs: 1,
              termination: "crash",
              artifacts: [],
            },
          ],
          inference: {
            ...emptyInference(),
          },
          rejectedDuplicates: 0,
        },
      ),
    ).toThrow("agent_context_exhausted");
  });
});

describe("agent execution grammar", () => {
  it("restricts a task naming one runtime while retaining shell for generic tasks", () => {
    const progress = { executions: [], inference: emptyInference(), rejectedDuplicates: 0 };
    const python = JSON.stringify(
      generationInput({ task: "Run this with Python", modelId: "test" }, progress).jsonSchema,
    );
    const generic = JSON.stringify(
      generationInput({ task: "Inspect the folder", modelId: "test" }, progress).jsonSchema,
    );

    expect(python).toContain('"const":"python"');
    expect(python).not.toContain('"const":"shell"');
    expect(generic).toContain('"const":"shell"');
  });
});

describe("agent repair history", () => {
  it("protects a failed execution in a successful run until the same path succeeds", () => {
    const failed = event("print(missing)", "NameError: missing");
    const repaired = event("print('fixed')", "", 0);
    const base = { messages: [], runs: [{ state: "succeeded" as const, events: [failed] }] };
    expect(assembleHistory(base, 3_000)).toContain("print(missing)");
    expect(
      assembleHistory(
        { messages: [], runs: [...base.runs, { state: "succeeded", events: [repaired] }] },
        3_000,
      ),
    ).not.toContain("Newest unsuperseded failed execution");
  });

  it("keeps assigned source after a helper failure before an execution result", () => {
    const started = AgentEventSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      sequence: 0,
      type: "execution.started",
      summary: "Run Python",
      language: "python",
      path: "steps/0001.py",
      source: `print('${"x".repeat(2_000)}')`,
      command: null,
      createdAt: new Date().toISOString(),
    });
    const failed = AgentEventSchema.parse({
      id: randomUUID(),
      runId: started.runId,
      sequence: 1,
      type: "run.failed",
      summary: "The helper exited before returning a result.",
      stderr: "agent_helper_exited_1",
      createdAt: new Date().toISOString(),
    });
    const history = assembleHistory(
      { messages: [], runs: [{ state: "failed", events: [started, failed] }] },
      3_000,
    );
    expect(history).toContain(started.source);
    expect(history).toContain(failed.summary);
    expect(history).toContain("agent_helper_exited_1");
  });
});

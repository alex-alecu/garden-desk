import type { AgentExecutionResult, ChatGenerationResult } from "@vault/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatInput } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import {
  artifactExecution,
  chatResult,
  cleanServiceFixtures,
  fixture,
  pendingQuestion,
  questionInference,
  successfulInference,
  terminal,
} from "./service-test-support.js";

function outputExecution(
  request: Parameters<typeof artifactExecution>[0],
  stdout: string,
): AgentExecutionResult {
  if (request.language === "shell") throw new Error("unexpected_shell");
  return {
    language: request.language,
    path: request.path,
    source: request.source ?? "print('resolved')",
    command: null,
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

function largeOutputInference() {
  let turn = 0;
  return {
    async chat() {
      turn += 1;
      return turn === 1
        ? chatResult("", [
            { id: "call-large", name: "python", params: { source: "print('large')" } },
          ])
        : chatResult("Finished safely.", []);
    },
  };
}

function completedAuditExecutionCounts(database: DatabasePort) {
  const rows = database
    .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
    .all() as Array<{ event_json: string }>;
  return rows
    .map(
      (row) =>
        JSON.parse(row.event_json) as {
          metadata: { executions?: number; guestExecutions?: number };
          type: string;
        },
    )
    .find((event) => event.type === "agent.completed")?.metadata;
}

afterEach(cleanServiceFixtures);

describe("persisted chat agent success", () => {
  it("commits tool evidence, a response, and a generated artifact", async () => {
    const { catalog, conversations, service } = await fixture(
      successfulInference(),
      artifactExecution,
    );
    const run = service.start(conversations.createSession(null).id, "Build a result");
    const snapshot = await terminal(service, run.id);
    expect(snapshot.run).toMatchObject({ state: "succeeded", response: "Finished safely." });
    expect(snapshot.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "tool.started",
        "execution.started",
        "execution.completed",
        "tool.completed",
        "assistant.completed",
      ]),
    );
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual(["result.txt"]);
    await service.close();
    catalog.close();
  });
});

describe("persisted artifact recovery", () => {
  it("restores an omitted artifact from committed workspace bytes after a later success", async () => {
    let execution = 0;
    const bytes = Buffer.from("recovered workspace bytes");
    const { catalog, conversations, service } = await fixture(
      {
        async chat() {
          return execution < 2
            ? chatResult("", [
                {
                  id: `call-${execution + 1}`,
                  name: "python",
                  params: { source: `print(${execution + 1})` },
                },
              ])
            : chatResult("Recovered the report.", []);
        },
      },
      async (request) => {
        execution += 1;
        const result = outputExecution(request, "done\n");
        if (execution === 1) {
          result.invalidatedArtifactPaths = ["report.txt"];
          result.recoverableArtifactPaths = ["report.txt"];
        }
        return result;
      },
      undefined,
      async (_sessionId, path) => (path === "report.txt" ? bytes : undefined),
    );

    const run = service.start(conversations.createSession(null).id, "Recover the report");
    const snapshot = await terminal(service, run.id);

    expect(snapshot.run.state).toBe("succeeded");
    expect(snapshot.artifacts.map((artifact) => artifact.name)).toEqual(["report.txt"]);
    expect(snapshot.artifacts[0]?.contentHash).toMatch(/^sha256:/u);
    await service.close();
    catalog.close();
  });
});

describe("persisted output spill budget", () => {
  it("audits spill processes without adding them to execution snapshots", async () => {
    let processes = 0;
    const { catalog, conversations, service } = await fixture(
      largeOutputInference(),
      async (request) => {
        processes += 1;
        return outputExecution(request, processes === 1 ? "x".repeat(60_000) : "");
      },
    );
    const run = service.start(conversations.createSession(null).id, "Build a large result");

    const snapshot = await terminal(service, run.id);

    expect(processes).toBe(3);
    expect(snapshot.executions).toHaveLength(1);
    expect(completedAuditExecutionCounts(catalog.database)).toMatchObject({
      executions: 1,
      guestExecutions: 3,
    });
    await service.close();
    catalog.close();
  });
});

describe("persisted chat agent questions", () => {
  it("blocks a live run on a question and resumes when answered", async () => {
    const { catalog, conversations, service } = await fixture(questionInference(), async () => {
      throw new Error("execution_should_not_start");
    });
    const run = service.start(conversations.createSession(null).id, "Which output do you want?");
    const question = await pendingQuestion(service, run.id);
    expect(service.snapshot(run.id).run.state).toBe("running");
    expect(service.settleQuestion(run.id, question.id, [["Full"]])).toBe(true);
    const snapshot = await terminal(service, run.id);
    expect(snapshot.run).toMatchObject({ state: "succeeded" });
    expect(snapshot.question).toBeNull();
    expect(snapshot.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["question.asked", "question.answered"]),
    );
    await service.close();
    catalog.close();
  });

  it("ignores an answer for a stale question id", async () => {
    const { catalog, conversations, service } = await fixture(questionInference(), async () => {
      throw new Error("execution_should_not_start");
    });
    const run = service.start(conversations.createSession(null).id, "Which output do you want?");
    const question = await pendingQuestion(service, run.id);
    expect(service.settleQuestion(run.id, "00000000-0000-4000-8000-000000000000", [["Full"]])).toBe(
      false,
    );
    expect(service.snapshot(run.id).question?.id).toBe(question.id);
    expect(service.settleQuestion(run.id, question.id, [["Summary"]])).toBe(true);
    await terminal(service, run.id);
    await service.close();
    catalog.close();
  });

  it("rejects multiple answers for a single-select question", async () => {
    const { catalog, conversations, service } = await fixture(questionInference(), async () => {
      throw new Error("execution_should_not_start");
    });
    const run = service.start(conversations.createSession(null).id, "Which output do you want?");
    const question = await pendingQuestion(service, run.id);
    expect(service.settleQuestion(run.id, question.id, [["Summary", "Full"]])).toBe(false);
    expect(service.settleQuestion(run.id, question.id, [["Summary"]])).toBe(true);
    await terminal(service, run.id);
    await service.close();
    catalog.close();
  });
});

describe("persisted chat agent cancellation", () => {
  it("cancels a run that is blocked on a question", async () => {
    const { catalog, conversations, service } = await fixture(questionInference(), async () => {
      throw new Error("execution_should_not_start");
    });
    const run = service.start(conversations.createSession(null).id, "Which output do you want?");
    await pendingQuestion(service, run.id);
    expect(service.cancel(run.jobId)).toBe(true);
    const snapshot = await terminal(service, run.id);
    expect(snapshot.run.state).toBe("cancelled");
    await service.close();
    catalog.close();
  });

  it("persists cancellation while inference is active", async () => {
    const inference = {
      async chat(_input: ChatInput, signal?: AbortSignal): Promise<ChatGenerationResult> {
        return await new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      },
    };
    const { catalog, conversations, service } = await fixture(inference, async () => {
      throw new Error("execution_should_not_start");
    });
    const run = service.start(conversations.createSession(null).id, "Cancel this task");
    expect(service.cancel(run.jobId)).toBe(true);
    const snapshot = await terminal(service, run.id);
    expect(snapshot.run.state).toBe("cancelled");
    expect(snapshot.events.at(-1)?.type).toBe("run.cancelled");
    await service.close();
    catalog.close();
  });
});

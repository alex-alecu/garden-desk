import type { AgentExecutionResult } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import { afterEach, expect, it } from "vitest";
import type { InferenceService } from "../runtime/inference.js";
import {
  cleanServiceFixtures,
  fixture,
  pathOnlyInference,
  successfulInference,
  terminal,
} from "./service-test-support.js";

afterEach(cleanServiceFixtures);

function completedAttempt(request: AgentSessionExecution): AgentExecutionResult {
  if (request.language === "shell") throw new Error("unexpected_shell");
  return {
    language: request.language,
    path: request.path,
    source: request.source ?? "print('committed bytes')\n",
    command: null,
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

async function preparedTransportFailure(
  inference: Partial<Pick<InferenceService, "chat" | "modelStatus">>,
  processStarted = false,
) {
  const { catalog, conversations, service } = await fixture(
    inference,
    async (request) => completedAttempt(request),
    async (observer) => {
      if (processStarted) {
        await observer?.onUpdate({ kind: "diagnostic", code: "process_start", platform: "guest" });
      }
      throw new Error("agent_helper_transport_failed");
    },
    async () => Buffer.from("print('committed bytes')\n"),
  );
  const run = service.start(conversations.createSession(null).id, "Run once.");
  const snapshot = await terminal(service, run.id);
  const audit = (
    catalog.database
      .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
      .all() as Array<{ event_json: string }>
  )
    .map(
      (row) =>
        JSON.parse(row.event_json) as {
          metadata: { executions?: number; guestExecutions?: number };
          type: string;
        },
    )
    .find((event) => event.type === "agent.completed");
  await service.close();
  catalog.close();
  return { audit, snapshot };
}

it("records terminal event and audit evidence for a prepared source transport failure", async () => {
  const { audit, snapshot } = await preparedTransportFailure(successfulInference());
  const events = snapshot.events.filter((event) => event.type.startsWith("execution."));

  expect(events.map((event) => event.type)).toEqual(["execution.started", "execution.completed"]);
  expect(events.at(-1)).toMatchObject({ termination: "crash", source: "print('ok')" });
  expect(audit?.metadata).toMatchObject({ executions: 1, guestExecutions: 0 });
});

it("records resolved source and terminal event for a path-only transport failure", async () => {
  const { audit, snapshot } = await preparedTransportFailure(pathOnlyInference());
  const events = snapshot.events.filter((event) => event.type.startsWith("execution."));

  expect(events.map((event) => event.type)).toEqual(["execution.started", "execution.completed"]);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "steps/saved.py", source: "print('committed bytes')\n" }),
    ]),
  );
  expect(audit?.metadata).toMatchObject({ executions: 1, guestExecutions: 0 });
});

it("counts a transport failure after the guest process starts", async () => {
  const { audit, snapshot } = await preparedTransportFailure(successfulInference(), true);

  expect(snapshot.executions[0]?.vmDiagnostics).toEqual([
    expect.objectContaining({ code: "process_start", platform: "guest" }),
  ]);
  expect(audit?.metadata).toMatchObject({ executions: 1, guestExecutions: 1 });
});

it("does not count a persisted pre-guest failure as a guest execution", async () => {
  const { catalog, conversations, service } = await fixture(successfulInference(), async () => {
    throw new Error("agent_launcher_failed");
  });
  const run = service.start(conversations.createSession(null).id, "Run once.");
  const snapshot = await terminal(service, run.id);
  const completed = (
    catalog.database
      .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
      .all() as Array<{ event_json: string }>
  )
    .map(
      (row) =>
        JSON.parse(row.event_json) as {
          metadata: { executions?: number; guestExecutions?: number };
          type: string;
        },
    )
    .find((event) => event.type === "agent.completed");

  expect(snapshot.executions).toHaveLength(1);
  expect(completed?.metadata).toMatchObject({ executions: 1, guestExecutions: 0 });
  await service.close();
  catalog.close();
});

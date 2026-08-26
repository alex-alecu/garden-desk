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
) {
  const { catalog, conversations, service } = await fixture(
    inference,
    async (request) => completedAttempt(request),
    async () => {
      throw new Error("agent_helper_transport_failed");
    },
  );
  const run = service.start(conversations.createSession(null).id, "Run once.");
  const snapshot = await terminal(service, run.id);
  const audit = (
    catalog.database
      .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
      .all() as Array<{ event_json: string }>
  )
    .map((row) => JSON.parse(row.event_json) as { metadata: { executions?: number }; type: string })
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
  expect(audit?.metadata.executions).toBe(1);
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
  expect(audit?.metadata.executions).toBe(1);
});

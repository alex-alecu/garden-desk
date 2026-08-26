import type { AgentExecutionResult } from "@vault/shared";
import type { AgentSessionExecution } from "@vault/workers";
import { afterEach, expect, it } from "vitest";
import type { ChatInput } from "../runtime/inference.js";
import {
  chatResult,
  cleanServiceFixtures,
  fixture,
  pathOnlyInference,
  terminal,
} from "./service-test-support.js";

afterEach(cleanServiceFixtures);

function followUpInference(requests: ChatInput[]) {
  let turn = 0;
  return {
    async chat(input: ChatInput) {
      requests.push(structuredClone(input));
      turn += 1;
      if (turn === 1) {
        return chatResult("", [
          { id: "internal", name: "python", params: { source: "print('internal')" } },
          {
            id: "saved",
            name: "python",
            params: { source: "print('saved')", path: "steps/report.py" },
          },
        ]);
      }
      return chatResult(turn === 2 ? "Saved the report script." : "Continued the report.", []);
    },
  };
}

async function successfulExecution(request: AgentSessionExecution): Promise<AgentExecutionResult> {
  if (request.language === "shell") throw new Error("unexpected_shell");
  return {
    language: request.language,
    path: request.path,
    source: request.source ?? "print('resolved')",
    command: null,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  };
}

it("offers only relative reusable scripts to a follow-up run", async () => {
  const requests: ChatInput[] = [];
  const { catalog, conversations, service } = await fixture(
    followUpInference(requests),
    successfulExecution,
  );
  const session = conversations.createSession(null);

  await terminal(service, service.start(session.id, "Save the report script.").id);
  await terminal(service, service.start(session.id, "Continue the report.").id);

  const followUp = requests[2]?.messages.at(-1);
  expect(followUp).toMatchObject({
    role: "user",
    text: expect.stringContaining("under /workspace: steps/report.py"),
  });
  if (followUp?.role !== "user") throw new Error("missing_follow_up_prompt");
  expect(followUp.text).not.toContain(".vault-tools/");
  expect(followUp.text).not.toContain("/workspace/steps/report.py");
  await service.close();
  catalog.close();
});

it("records the exact source resolved for a path-only execution", async () => {
  const requests: AgentSessionExecution[] = [];
  const committedSource = "print('last committed bytes')\n";
  const { catalog, conversations, service } = await fixture(
    pathOnlyInference(),
    async (request): Promise<AgentExecutionResult> => {
      requests.push(request);
      if (request.language === "shell") throw new Error("unexpected_shell");
      return {
        language: request.language,
        path: request.path,
        source: committedSource,
        command: null,
        exitCode: 0,
        stdout: "last committed bytes\n",
        stderr: "",
        durationMs: 2,
        termination: "completed",
        artifacts: [],
      };
    },
    undefined,
    async () => Buffer.from(committedSource),
  );

  const run = service.start(conversations.createSession(null).id, "Rerun the saved script");
  const snapshot = await terminal(service, run.id);

  expect(requests).toEqual([{ language: "python", path: "steps/saved.py" }]);
  expect(snapshot.executions[0]).toMatchObject({
    path: "steps/saved.py",
    source: committedSource,
    state: "completed",
  });
  await service.close();
  catalog.close();
});

it("terminalizes a prepared execution when the guest boundary throws", async () => {
  const committedSource = "print('prepared bytes')\n";
  const { catalog, conversations, service } = await fixture(
    pathOnlyInference(),
    async (request): Promise<AgentExecutionResult> => {
      if (request.language === "shell") throw new Error("unexpected_shell");
      return {
        language: request.language,
        path: request.path,
        source: committedSource,
        command: null,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        termination: "completed",
        artifacts: [],
      };
    },
    async () => {
      throw new Error("agent_helper_transport_failed");
    },
    async () => Buffer.from(committedSource),
  );

  const run = service.start(conversations.createSession(null).id, "Rerun the saved script");
  const snapshot = await terminal(service, run.id);

  expect(snapshot.run.state).toBe("succeeded");
  expect(snapshot.executions).toEqual([
    expect.objectContaining({
      path: "steps/saved.py",
      source: committedSource,
      state: "failed",
      termination: "crash",
    }),
  ]);
  await service.close();
  catalog.close();
});

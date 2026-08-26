import { randomUUID } from "node:crypto";
import type { CodeAgentLauncher } from "@vault/workers";
import { expect, it } from "vitest";
import { AgentSessionManager } from "./session-manager.js";

const limits = {
  wallTimeMs: 1_000,
  inputCount: 1,
  inputBytes: 1_024,
  memoryBytes: 256 * 1_024 * 1_024,
  scratchBytes: 128 * 1_024 * 1_024,
  outputBytes: 1_024,
  cpuCount: 1,
};

it("keeps one warm session across repeated path preparation failures", async () => {
  const events: string[] = [];
  const launcher: CodeAgentLauncher = {
    async openAgentSession() {
      events.push("open");
      return {
        async execute() {
          events.push("prepare");
          throw new Error("agent_script_missing");
        },
        async cancel() {},
        async close() {
          events.push("close");
        },
      };
    },
    async deleteWorkspace() {},
  };
  const manager = new AgentSessionManager(
    launcher,
    {
      async resolve() {
        return { sourceFolder: "/source", attachments: [], async dispose() {} };
      },
    },
    limits,
  );
  const sessionId = randomUUID();

  await expect(
    manager.execute(sessionId, { language: "python", path: "steps/missing.py" }),
  ).rejects.toThrow("agent_script_missing");
  await expect(
    manager.execute(sessionId, { language: "python", path: "steps/missing.py" }),
  ).rejects.toThrow("agent_script_missing");

  expect(events).toEqual(["open", "prepare", "prepare"]);
  await manager.close();
  expect(events).toEqual(["open", "prepare", "prepare", "close"]);
});

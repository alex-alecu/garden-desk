import { randomUUID } from "node:crypto";
import type { CodeAgentLauncher } from "@vault/workers";
import { describe, expect, it } from "vitest";
import type { AgentInputResolver } from "./inputs.js";
import { AgentSessionManager } from "./session-manager.js";

const limits = {
  wallTimeMs: 1_000,
  inputCount: 64,
  inputBytes: 1024,
  memoryBytes: 256 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 1024,
  cpuCount: 1,
};

function launcher(events: string[], failureCount = 0): CodeAgentLauncher {
  let remainingFailures = failureCount;
  return {
    async openAgentSession(request) {
      events.push(`open:${request.sessionId}`);
      return {
        async execute() {
          events.push(`execute:${request.sessionId}`);
          if (remainingFailures > 0) {
            remainingFailures -= 1;
            throw new Error("agent_helper_closed");
          }
          return {
            language: "shell",
            path: null,
            source: null,
            command: "true",
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            durationMs: 1,
            termination: "completed",
            artifacts: [],
          };
        },
        async cancel() {},
        async close() {
          events.push(`close:${request.sessionId}`);
        },
      };
    },
    async deleteWorkspace(sessionId) {
      events.push(`delete:${sessionId}`);
    },
  };
}

function resolver(events: string[]): Pick<AgentInputResolver, "resolve"> {
  return {
    async resolve(sessionId: string) {
      return {
        sourceFolder: `/source/${sessionId}`,
        attachments: [],
        inputNames: [],
        async dispose() {
          events.push(`dispose:${sessionId}`);
        },
      };
    },
  };
}

describe("single-capacity warm agent VM", () => {
  it("reuses one session and evicts it before opening another", async () => {
    const events: string[] = [];
    const manager = new AgentSessionManager(launcher(events), resolver(events), limits);
    const first = randomUUID();
    const second = randomUUID();
    await manager.execute(first, { language: "shell", command: "true" });
    await manager.execute(first, { language: "shell", command: "true" });
    await manager.warmSession(second);
    await manager.closeSession(second, true);

    expect(events).toEqual([
      `open:${first}`,
      `execute:${first}`,
      `execute:${first}`,
      `close:${first}`,
      `dispose:${first}`,
      `open:${second}`,
      `close:${second}`,
      `dispose:${second}`,
      `delete:${second}`,
    ]);
  });
});

describe("memory-bounded parallel agent VMs", () => {
  it("runs different sessions at the configured capacity", async () => {
    const events: string[] = [];
    let entered = 0;
    let bothEntered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((accept) => {
      bothEntered = accept;
    });
    const proceed = new Promise<void>((accept) => {
      release = accept;
    });
    const codeLauncher = launcher(events);
    const open = codeLauncher.openAgentSession.bind(codeLauncher);
    codeLauncher.openAgentSession = async (request) => {
      const session = await open(request);
      return {
        ...session,
        async execute(execution, signal, observer) {
          entered += 1;
          if (entered === 2) bothEntered();
          await proceed;
          return await session.execute(execution, signal, observer);
        },
      };
    };
    const manager = new AgentSessionManager(codeLauncher, resolver(events), limits, 2);
    const first = randomUUID();
    const second = randomUUID();
    const executions = [
      manager.execute(first, { language: "shell", command: "true" }),
      manager.execute(second, { language: "shell", command: "true" }),
    ];

    await ready;
    expect(events.filter((event) => event.startsWith("open:"))).toHaveLength(2);
    release();
    await Promise.all(executions);
    await manager.close();
  });
});

describe("agent session cancellation", () => {
  it("does not open or execute a session after cancellation", async () => {
    const events: string[] = [];
    const manager = new AgentSessionManager(launcher(events), resolver(events), limits);
    const controller = new AbortController();
    controller.abort();

    await expect(
      manager.execute(randomUUID(), { language: "shell", command: "true" }, controller.signal),
    ).rejects.toThrow();
    expect(events).toEqual([]);
  });
});

describe("agent helper recovery", () => {
  it("evicts a failed helper before recreating the session", async () => {
    const events: string[] = [];
    const manager = new AgentSessionManager(launcher(events, 1), resolver(events), limits);
    const sessionId = randomUUID();

    await expect(
      manager.execute(sessionId, { language: "shell", command: "false" }),
    ).rejects.toThrow("agent_helper_closed");
    await manager.execute(sessionId, { language: "shell", command: "true" });

    expect(events.filter((event) => event === `open:${sessionId}`)).toHaveLength(2);
    expect(events).toContain(`close:${sessionId}`);
    expect(events).toContain(`dispose:${sessionId}`);
  });
});

describe("warm session lifecycle diagnostics", () => {
  it("replays buffered startup diagnostics and retains teardown on the execution", async () => {
    const diagnostics: string[] = [];
    const codeLauncher: CodeAgentLauncher = {
      async openAgentSession(request) {
        await request.observer?.onUpdate({
          kind: "diagnostic",
          code: "vm_start",
          platform: "macos",
        });
        return {
          async execute() {
            return {
              language: "shell",
              path: null,
              source: null,
              command: "true",
              exitCode: 0,
              stdout: "",
              stderr: "",
              durationMs: 1,
              termination: "completed",
              artifacts: [],
            };
          },
          async cancel() {},
          async close() {
            await request.observer?.onUpdate({
              kind: "diagnostic",
              code: "teardown",
              platform: "macos",
            });
          },
        };
      },
      async deleteWorkspace() {},
    };
    const manager = new AgentSessionManager(codeLauncher, resolver([]), limits);
    const sessionId = randomUUID();
    await manager.warmSession(sessionId);
    await manager.execute(sessionId, { language: "shell", command: "true" }, undefined, {
      executionId: randomUUID(),
      onUpdate(update) {
        if (update.kind === "diagnostic") diagnostics.push(update.code);
      },
    });
    await manager.closeSession(sessionId);
    expect(diagnostics).toEqual(["vm_start", "teardown"]);
  });
});

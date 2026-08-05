import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentDecision, AgentExecutionResult } from "@vault/shared";
import type { AgentSessionExecution, CodeAgentLauncher } from "@vault/workers";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { AgentService } from "./service.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

function fakeLauncher(
  execute: (request: AgentSessionExecution) => Promise<AgentExecutionResult>,
): CodeAgentLauncher {
  return {
    async openAgentSession() {
      return {
        async execute(request, _signal, observer) {
          await observer?.onUpdate({
            kind: "diagnostic",
            code: "process_start",
            platform: "guest",
          });
          const result = await execute(request);
          if (result.stdout.length > 0) {
            await observer?.onUpdate({
              kind: "stream",
              stream: "stdout",
              bytes: Buffer.from(result.stdout),
            });
          }
          if (result.stderr.length > 0) {
            await observer?.onUpdate({
              kind: "stream",
              stream: "stderr",
              bytes: Buffer.from(result.stderr),
            });
          }
          await observer?.onUpdate({
            kind: "diagnostic",
            code: "process_exit",
            platform: "guest",
          });
          return result;
        },
        async cancel() {},
        async close() {},
      };
    },
    async deleteWorkspace() {},
  };
}

async function waitForTerminal(service: AgentService, runId: string) {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    const snapshot = service.snapshot(runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 10));
  }
  throw new Error("agent_test_timeout");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one complete lifecycle is the behavior under test.
describe("M3 persisted agent lifecycle", () => {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: setup and assertions deliberately show the complete persisted boundary.
  it("commits a multi-step response, events, and immutable generated artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-agent-service-"));
    roots.push(root);
    const scope = await WorkspaceScope.create(root);
    const catalog = openWorkspaceCatalog(scope.root);
    const artifacts = await ArtifactStore.create(scope);
    const conversations = new ConversationStore(catalog.database);
    const store = new AgentStore(catalog.database, artifacts);
    const decisions: AgentDecision[] = [
      { action: "execute", language: "python", source: "print('ok')", summary: "Run Python" },
      { action: "respond", response: "Finished safely.", artifacts: ["result.txt"] },
    ];
    let runId = "";
    let generation = 0;
    const inference: Pick<InferenceService, "generate"> = {
      async generate() {
        generation += 1;
        if (generation === 2) expect(store.snapshot(runId).artifacts).toHaveLength(0);
        const value = decisions.shift();
        if (value === undefined) throw new Error("missing_decision");
        return {
          protocolVersion: 1,
          requestId: "agent-test",
          status: "ok",
          operation: "generate",
          value,
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance: {
            promptTokens: 10,
            outputTokens: 5,
            promptDurationMs: 100,
            generationDurationMs: 500,
            totalDurationMs: 600,
          },
        };
      },
    };
    const launcher = fakeLauncher(async (request) => {
      if (request.language === "shell") throw new Error("unexpected_shell");
      return {
        language: request.language,
        path: request.path,
        source: request.source,
        command: null,
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
        durationMs: 2,
        termination: "completed",
        artifacts: [
          {
            name: "result.txt",
            mediaType: "text/plain",
            bytesBase64: Buffer.from("result").toString("base64"),
          },
        ],
      };
    });
    const service = new AgentService(
      catalog.database,
      store,
      conversations,
      new JobStore(catalog.database),
      artifacts,
      inference,
      launcher,
      new AuditLog(catalog.database),
    );
    const session = conversations.createSession(null);
    const run = service.start(session.id, "Build a result");
    runId = run.id;
    expect(() => service.start(session.id, "Interleave another run")).toThrow("agent_busy");
    await expect(service.warmSession(session.id)).resolves.toBeUndefined();
    const snapshot = await waitForTerminal(service, run.id);

    expect(service.listRuns(session.id).map((item) => item.id)).toEqual([run.id]);
    expect(snapshot.run).toMatchObject({ state: "succeeded", response: "Finished safely." });
    expect(snapshot.run.performance).toMatchObject({
      promptTokens: 20,
      outputTokens: 10,
      tokensPerSecond: 10,
      promptTokensPerSecond: 100,
    });
    expect(snapshot.thinking).toBeNull();
    expect(snapshot.events.map((item) => item.type)).toEqual([
      "run.started",
      "inference.started",
      "execution.started",
      "execution.completed",
      "inference.started",
      "assistant.completed",
    ]);
    expect(snapshot.events.find((item) => item.type === "execution.completed")).toMatchObject({
      path: "steps/0001.py",
      source: "print('ok')",
      exitCode: 0,
      durationMs: 2,
      termination: "completed",
    });
    expect(snapshot.events.find((item) => item.type === "execution.started")).toMatchObject({
      path: "steps/0001.py",
      source: "print('ok')",
    });
    expect(snapshot.artifacts).toHaveLength(1);
    expect(conversations.listMessages(session.id).map((item) => item.role)).toEqual([
      "user",
      "assistant",
    ]);
    await service.close();
    catalog.close();
  }, 15_000);

  it("persists an explicit cancelled outcome", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-agent-cancel-"));
    roots.push(root);
    const scope = await WorkspaceScope.create(root);
    const catalog = openWorkspaceCatalog(scope.root);
    const artifacts = await ArtifactStore.create(scope);
    const conversations = new ConversationStore(catalog.database);
    const store = new AgentStore(catalog.database, artifacts);
    const inference: Pick<InferenceService, "generate"> = {
      async generate(_input, signal) {
        signal?.throwIfAborted();
        return await new Promise((_accept, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const launcher = fakeLauncher(async () => {
      throw new Error("execution_should_not_start");
    });
    const service = new AgentService(
      catalog.database,
      store,
      conversations,
      new JobStore(catalog.database),
      artifacts,
      inference,
      launcher,
      new AuditLog(catalog.database),
    );
    const session = conversations.createSession(null);
    const run = service.start(session.id, "Cancel this task");
    expect(service.cancel(run.jobId)).toBe(true);
    const snapshot = await waitForTerminal(service, run.id);
    expect(snapshot.run.state).toBe("cancelled");
    expect(snapshot.events.at(-1)?.type).toBe("run.cancelled");
    await service.close();
    catalog.close();
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: setup and assertions keep the cancellation race at the persisted boundary.
  it("preserves a cancellation accepted before success commits", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-agent-late-cancel-"));
    roots.push(root);
    const scope = await WorkspaceScope.create(root);
    const catalog = openWorkspaceCatalog(scope.root);
    const artifacts = await ArtifactStore.create(scope);
    const conversations = new ConversationStore(catalog.database);
    const store = new AgentStore(catalog.database, artifacts);
    let service: AgentService;
    let jobId = "";
    const inference: Pick<InferenceService, "generate"> = {
      async generate() {
        expect(service.cancel(jobId)).toBe(true);
        return {
          protocolVersion: 1,
          requestId: "agent-late-cancel-test",
          status: "ok",
          operation: "generate",
          value: { action: "respond", response: "This must not commit." },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
            detectedGpuVramBytes: 1,
          },
          performance: {
            promptTokens: 1,
            outputTokens: 1,
            promptDurationMs: 1,
            generationDurationMs: 1,
            totalDurationMs: 2,
          },
        };
      },
    };
    const launcher = fakeLauncher(async () => {
      throw new Error("execution_should_not_start");
    });
    service = new AgentService(
      catalog.database,
      store,
      conversations,
      new JobStore(catalog.database),
      artifacts,
      inference,
      launcher,
      new AuditLog(catalog.database),
    );
    const session = conversations.createSession(null);
    const run = service.start(session.id, "Cancel at completion");
    jobId = run.jobId;
    const snapshot = await waitForTerminal(service, run.id);
    const job = catalog.database
      .prepare("SELECT state, cancellation_requested FROM jobs WHERE id = ?")
      .get(run.jobId);

    expect(snapshot.run).toMatchObject({ state: "cancelled", response: null });
    expect(snapshot.events.at(-1)?.type).toBe("run.cancelled");
    expect(conversations.listMessages(session.id).map((item) => item.role)).toEqual(["user"]);
    expect(job).toEqual({ state: "cancelled", cancellation_requested: 1 });
    await service.close();
    catalog.close();
  });
});

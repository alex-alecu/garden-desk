import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult, ChatGenerationResult } from "@vault/shared";
import type { AgentSessionExecution, CodeAgentLauncher } from "@vault/workers";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import type { ChatInput, InferenceService } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { AgentService } from "./service.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

function chatResult(
  text: string,
  toolCalls: ChatGenerationResult["toolCalls"],
): ChatGenerationResult {
  return {
    protocolVersion: 1,
    requestId: "agent-test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "toolCalls" : "text",
    memory: {
      cpuRamBytes: 1,
      gpuVramBytes: 1,
      budgetBytes: 2,
      detectedGpuVramBytes: 1,
      contextSizeTokens: 16_384,
    },
    performance: {
      promptTokens: 10,
      outputTokens: 5,
      promptDurationMs: 100,
      generationDurationMs: 500,
      totalDurationMs: 600,
    },
  };
}

function launcher(
  run: (request: AgentSessionExecution) => Promise<AgentExecutionResult>,
): CodeAgentLauncher {
  return {
    async openAgentSession() {
      return {
        async execute(request, _signal, observer) {
          const result = await run(request);
          if (result.stdout.length > 0)
            await observer?.onUpdate({
              kind: "stream",
              stream: "stdout",
              bytes: Buffer.from(result.stdout),
            });
          if (result.stderr.length > 0)
            await observer?.onUpdate({
              kind: "stream",
              stream: "stderr",
              bytes: Buffer.from(result.stderr),
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

async function fixture(
  inference: Partial<Pick<InferenceService, "chat" | "modelStatus">>,
  execute: (request: AgentSessionExecution) => Promise<AgentExecutionResult>,
) {
  const root = await mkdtemp(join(tmpdir(), "vault-agent-service-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const store = new AgentStore(catalog.database, artifacts);
  const service = new AgentService(
    catalog.database,
    store,
    conversations,
    new JobStore(catalog.database),
    artifacts,
    inference,
    launcher(execute),
    new AuditLog(catalog.database),
  );
  return { catalog, conversations, service };
}

async function terminal(service: AgentService, runId: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const snapshot = service.snapshot(runId);
    if (!(["queued", "running"] as const).includes(snapshot.run.state as "queued" | "running"))
      return snapshot;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

function successfulInference() {
  let turn = 0;
  return {
    async chat(_input: ChatInput) {
      turn += 1;
      return turn === 1
        ? chatResult("", [{ id: "call-1", name: "python", params: { source: "print('ok')" } }])
        : chatResult("Finished safely.", []);
    },
  };
}

async function artifactExecution(request: AgentSessionExecution): Promise<AgentExecutionResult> {
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
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe("persisted chat agent cancellation", () => {
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

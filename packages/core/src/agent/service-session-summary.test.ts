import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatGenerationResult } from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import type { ChatInput } from "../runtime/inference.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { AgentService } from "./service.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

function result(text: string): ChatGenerationResult {
  return {
    protocolVersion: 1,
    requestId: "summary-test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuVramBytes: 1,
      budgetBytes: 2,
      detectedGpuVramBytes: 1,
      contextSizeTokens: 65_536,
    },
    performance: {
      promptTokens: 1,
      outputTokens: 1,
      promptDurationMs: 1,
      generationDurationMs: 1,
      totalDurationMs: 2,
    },
  };
}

const launcher: CodeAgentLauncher = {
  async openAgentSession() {
    return {
      async execute() {
        throw new Error("execution_should_not_start");
      },
      async cancel() {},
      async close() {},
    };
  },
  async deleteWorkspace() {},
};

async function terminal(service: AgentService, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const state = service.snapshot(runId).run.state;
    if (state !== "queued" && state !== "running") return;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

async function startWhenIdle(service: AgentService, sessionId: string, task: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      return service.start(sessionId, task);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "agent_busy") throw error;
      await new Promise((accept) => setTimeout(accept, 2));
    }
  }
  throw new Error("agent_idle_timeout");
}

async function summaryFixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-agent-summary-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const requests: ChatInput[] = [];
  const inference = {
    async chat(input: ChatInput) {
      requests.push(input);
      const system = input.messages[0];
      const summarizing = system?.role === "system" && system.text.startsWith("Produce only");
      return result(summarizing ? "## Objective\n- Keep working\n## Facts\n- Local" : "Done.");
    },
    async modelStatus() {
      return {
        modelId: "model",
        name: "Gemma",
        state: "ready",
        thinkingSupported: true,
        contextSizeTokens: 65_536,
      } as never;
    },
  };
  const service = new AgentService(
    catalog.database,
    new AgentStore(catalog.database, artifacts),
    conversations,
    new JobStore(catalog.database),
    artifacts,
    inference,
    launcher,
    new AuditLog(catalog.database),
  );
  return { catalog, conversations, requests, service };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("anchored session summary lifecycle", () => {
  it("persists a summary and places it in a later model history", async () => {
    const { catalog, conversations, requests, service } = await summaryFixture();
    const session = conversations.createSession(null);
    for (const task of ["First", "Second", "Third"]) {
      const run = await startWhenIdle(service, session.id, task);
      await terminal(service, run.id);
    }
    const anchor = catalog.database
      .prepare("SELECT text FROM agent_session_summaries WHERE session_id = ?")
      .get(session.id) as { text: string } | undefined;
    expect(anchor?.text).toContain("Keep working");
    expect(
      requests.some((request) =>
        request.messages.some(
          (message) => message.role === "user" && message.text.includes("<anchored-summary>"),
        ),
      ),
    ).toBe(true);
    await service.close();
    catalog.close();
  });
});

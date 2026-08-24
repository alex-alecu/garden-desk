// biome-ignore lint/style/noRestrictedImports: this focused test helper owns temporary fixture cleanup.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatGenerationResult } from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";
import { afterEach } from "vitest";
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

export function isSummaryRequest(request: ChatInput): boolean {
  const first = request.messages.at(0);
  return first?.role === "system" && first.text.startsWith("Produce only");
}

export function result(text: string, measuredContextTokens?: number): ChatGenerationResult {
  return {
    protocolVersion: 2,
    requestId: "summary-test",
    status: "ok",
    operation: "chat",
    text,
    toolCalls: [],
    stopReason: "text",
    memory: {
      cpuRamBytes: 1,
      gpuMemoryBytes: 1,
      budgetBytes: 2,
      detectedGpuMemoryBytes: 1,
      gpuMemoryKind: "unified" as const,
      backend: "metal" as const,
      selectedDeviceCount: 1 as const,
      ...(measuredContextTokens === undefined ? {} : { contextSizeTokens: measuredContextTokens }),
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

export async function terminal(service: AgentService, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const state = service.snapshot(runId).run.state;
    if (state !== "queued" && state !== "running") return;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

export async function startWhenIdle(service: AgentService, sessionId: string, task: string) {
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

export async function summaryFixture(
  options: {
    contextSizeTokens?: number | "auto";
    measuredContextTokens?: number | null;
    summarize?: (signal: AbortSignal | undefined) => Promise<ChatGenerationResult>;
  } = {},
) {
  const contextSizeTokens = options.contextSizeTokens ?? 65_536;
  const measuredContextTokens =
    options.measuredContextTokens === null ? undefined : (options.measuredContextTokens ?? 65_536);
  const root = await mkdtemp(join(tmpdir(), "vault-agent-summary-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const requests: ChatInput[] = [];
  const inference = {
    async chat(input: ChatInput, signal?: AbortSignal) {
      requests.push(input);
      const summarizing = isSummaryRequest(input);
      if (summarizing && options.summarize !== undefined) return await options.summarize(signal);
      return result(
        summarizing ? "## Objective\n- Keep working\n## Facts\n- Local" : "Done.",
        measuredContextTokens,
      );
    },
    async modelStatus() {
      return {
        modelId: "model",
        name: "Gemma",
        state: "ready",
        thinkingSupported: true,
        contextSizeTokens,
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

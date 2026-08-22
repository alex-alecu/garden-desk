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

function isSummaryRequest(request: ChatInput): boolean {
  const first = request.messages.at(0);
  return first?.role === "system" && first.text.startsWith("Produce only");
}

function result(text: string, measuredContextTokens?: number): ChatGenerationResult {
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
async function summaryFixture(
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: lifecycle cases share one persistent service fixture.
describe("anchored session summary lifecycle", () => {
  it("skips refresh when the worker does not measure its allocation", async () => {
    const { catalog, conversations, requests, service } = await summaryFixture({
      contextSizeTokens: 65_536,
      measuredContextTokens: null,
    });
    const session = conversations.createSession(null);
    for (const task of ["First", "Second"]) {
      const run = await startWhenIdle(service, session.id, task);
      await terminal(service, run.id);
    }
    await service.close();
    const anchor = catalog.database
      .prepare("SELECT text FROM agent_session_summaries WHERE session_id = ?")
      .get(session.id);
    expect(anchor).toBeUndefined();
    expect(requests.some((request) => isSummaryRequest(request))).toBe(false);
    catalog.close();
  });

  it("refreshes after an auto request receives a measured allocation", async () => {
    const { catalog, conversations, requests, service } = await summaryFixture({
      contextSizeTokens: "auto",
    });
    const session = conversations.createSession(null);
    for (const task of ["First", "Second"]) {
      const run = await startWhenIdle(service, session.id, task);
      await terminal(service, run.id);
    }
    await service.close();

    expect(requests[0]).toMatchObject({ contextSize: "auto" });
    expect(requests.some((request) => isSummaryRequest(request))).toBe(true);
    expect(
      catalog.database
        .prepare("SELECT text FROM agent_session_summaries WHERE session_id = ?")
        .get(session.id),
    ).toBeDefined();
    catalog.close();
  });

  it("waits for a pending summary before a later prompt uses its anchor", async () => {
    let releaseSummary: (() => void) | undefined;
    const summaryPending = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    let summaryStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      summaryStarted = resolve;
    });
    const { catalog, conversations, requests, service } = await summaryFixture({
      summarize: async () => {
        summaryStarted?.();
        await summaryPending;
        return result("## Objective\n- Anchored", 65_536);
      },
    });
    const session = conversations.createSession(null);
    conversations.appendMessage(session.id, "user", "Earlier");
    conversations.appendMessage(session.id, "assistant", "Earlier");
    const first = await startWhenIdle(service, session.id, "First");
    await terminal(service, first.id);
    await started;

    const second = await startWhenIdle(service, session.id, "Second");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const primary = () => requests.filter((request) => !isSummaryRequest(request));
    expect(primary()).toHaveLength(1);
    expect(service.snapshot(second.id).run.state).toBe("queued");

    releaseSummary?.();
    await terminal(service, second.id);
    await service.close();

    expect(primary()[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Anchored summary of earlier turns:"),
        }),
      ]),
    );
    catalog.close();
  });

  it("releases a completed session while a failed summary refresh remains pending", async () => {
    let startSummary: (() => void) | undefined;
    let releaseSummary: (() => void) | undefined;
    const summaryStarted = new Promise<void>((resolve) => {
      startSummary = resolve;
    });
    const summaryPending = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    let summaries = 0;
    const { catalog, conversations, service } = await summaryFixture({
      summarize: async () => {
        summaries += 1;
        if (summaries === 1) {
          startSummary?.();
          await summaryPending;
          throw new Error("summary_failed");
        }
        return result("## Objective\n- Continue");
      },
    });
    const session = conversations.createSession(null);
    const first = await startWhenIdle(service, session.id, "First");
    await terminal(service, first.id);
    expect(service.snapshot(first.id).run.state).toBe("succeeded");
    const second = await startWhenIdle(service, session.id, "Second");
    await terminal(service, second.id);
    expect(service.snapshot(second.id).run.state).toBe("succeeded");
    await summaryStarted;

    expect(service.snapshot(second.id).run.state).toBe("succeeded");
    const third = await startWhenIdle(service, session.id, "Third");
    releaseSummary?.();
    await terminal(service, third.id);
    await service.close();

    expect(service.snapshot(second.id).run.state).toBe("succeeded");
    catalog.close();
  });

  it("cancels a pending summary when the service closes", async () => {
    const { promise: summaryStarted, resolve: startSummary } = Promise.withResolvers<void>();
    const { promise: cancelled, resolve: recordCancellation } = Promise.withResolvers<void>();
    const { catalog, conversations, service } = await summaryFixture({
      summarize: async (signal) =>
        await new Promise<ChatGenerationResult>((_resolve, reject) => {
          const abort = () => {
            recordCancellation();
            reject(signal?.reason);
          };
          startSummary();
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        }),
    });
    const session = conversations.createSession(null);
    conversations.appendMessage(session.id, "user", "Earlier");
    conversations.appendMessage(session.id, "assistant", "Earlier");
    const run = await startWhenIdle(service, session.id, "First");
    await terminal(service, run.id);
    await summaryStarted;

    await expect(service.close()).resolves.toBeUndefined();
    await cancelled;
    expect(service.snapshot(run.id).run.state).toBe("succeeded");
    catalog.close();
  });
});

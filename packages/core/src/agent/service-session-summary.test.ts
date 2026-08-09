import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult } from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";
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

const completed: AgentExecutionResult = {
  language: "python",
  path: "steps/0001.py",
  source: "print('ok')",
  command: null,
  exitCode: 0,
  stdout: "ok\n",
  stderr: "",
  durationMs: 1,
  termination: "completed",
  artifacts: [],
};

function launcher(): CodeAgentLauncher {
  return {
    async openAgentSession() {
      return {
        async execute() {
          return completed;
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one complete multi-turn session is the behavior under test.
describe("anchored session summary lifecycle", () => {
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: setup and assertions show the complete anchored boundary.
  it("persists an anchored summary and offers it to the next run", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-agent-summary-"));
    roots.push(root);
    const scope = await WorkspaceScope.create(root);
    const catalog = openWorkspaceCatalog(scope.root);
    const artifacts = await ArtifactStore.create(scope);
    const conversations = new ConversationStore(catalog.database);
    const store = new AgentStore(catalog.database, artifacts);
    const prompts: string[] = [];
    const inference: Pick<InferenceService, "generate"> & Pick<InferenceService, "modelStatus"> = {
      async generate(input) {
        prompts.push(input.prompt);
        const summarizing = input.prompt.startsWith(
          "You are summarizing an offline knowledge-work session",
        );
        return {
          protocolVersion: 1,
          requestId: "summary-lifecycle",
          status: "ok",
          operation: "generate",
          value: summarizing
            ? { summary: ["## Objective", "- Keep the invoice review going."] }
            : { action: "respond", response: ["Done."], artifacts: [], skills: [] },
          memory: {
            cpuRamBytes: 1,
            gpuVramBytes: 1,
            budgetBytes: 1,
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
      },
      async modelStatus() {
        return {
          modelId: "gemma-4-12b-it-qat-q4_0",
          name: "Gemma 4 12B QAT",
          state: "ready",
          thinkingSupported: true,
          contextSizeTokens: 65_536,
        } as never;
      },
    };
    const service = new AgentService(
      catalog.database,
      store,
      conversations,
      new JobStore(catalog.database),
      artifacts,
      inference,
      launcher(),
      new AuditLog(catalog.database),
    );
    const session = conversations.createSession(null);
    // Five turns: the first anchors, and later turns accumulate enough new messages
    // to merge into that anchor instead of re-deriving it.
    const filler = " background-note".repeat(4_000);
    const tasks = [
      `Review the invoices.${filler}`,
      `Now filter them.${filler}`,
      `Then total them.${filler}`,
      `Export the workbook.${filler}`,
      "Confirm the totals.",
    ];
    for (const task of tasks) {
      const run = service.start(session.id, task);
      await waitForTerminal(service, run.id);
    }

    const anchored = catalog.database
      .prepare(
        "SELECT text, covered_message_count AS count FROM agent_session_summaries WHERE session_id = ?",
      )
      .get(session.id) as { text: string; count: number } | undefined;
    expect(anchored?.text).toContain("Keep the invoice review going.");
    expect(anchored?.count).toBeGreaterThan(0);
    // A later turn merges into the stored anchor rather than re-deriving it.
    expect(prompts.some((prompt) => prompt.includes("<previous-summary>"))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("Anchored summary of earlier turns"))).toBe(
      true,
    );

    await service.close();
    catalog.close();
  });
});

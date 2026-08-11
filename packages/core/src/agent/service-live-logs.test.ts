// biome-ignore lint/style/noRestrictedImports: isolated test fixtures use temporary directories.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function executeDecisionInference(): Pick<InferenceService, "chat"> {
  return {
    async chat() {
      return {
        protocolVersion: 1,
        requestId: "agent-launch-failure-test",
        status: "ok",
        operation: "chat",
        text: "",
        toolCalls: [{ id: "call-1", name: "python", params: { source: "print('partial')" } }],
        stopReason: "toolCalls",
        memory: {
          cpuRamBytes: 1,
          gpuVramBytes: 1,
          budgetBytes: 1,
          detectedGpuVramBytes: 1,
          contextSizeTokens: 16_384,
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
}

function failedLauncher(): CodeAgentLauncher {
  return {
    async openAgentSession(request) {
      await request.observer?.onUpdate({
        kind: "diagnostic",
        code: "vm_start",
        platform: "macos",
      });
      await request.observer?.onUpdate({
        kind: "diagnostic",
        code: "platform_error",
        platform: "macos",
        platformCode: "VZErrorDomain:1",
      });
      throw new Error("agent_vm_launch_failed");
    },
    async deleteWorkspace() {},
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-agent-failure-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const service = new AgentService(
    catalog.database,
    new AgentStore(catalog.database, artifacts),
    conversations,
    new JobStore(catalog.database),
    artifacts,
    executeDecisionInference(),
    failedLauncher(),
    new AuditLog(catalog.database),
  );
  return { catalog, conversations, service };
}

async function waitForTerminal(service: AgentService, runId: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const snapshot = service.snapshot(runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M3 failed agent launch evidence", () => {
  it("retains allowlisted diagnostics emitted before launch failure", async () => {
    const { catalog, conversations, service } = await fixture();
    const session = conversations.createSession(null);
    const run = service.start(session.id, "Run a task");
    const snapshot = await waitForTerminal(service, run.id);

    expect(snapshot.run.state).toBe("failed");
    expect(snapshot.executions[0]).toMatchObject({
      state: "failed",
      termination: "crash",
      vmDiagnostics: [
        { code: "vm_start", platform: "macos" },
        { code: "platform_error", platform: "macos", platformCode: "VZErrorDomain:1" },
      ],
    });
    await service.close();
    catalog.close();
  });
});

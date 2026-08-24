// biome-ignore lint/style/noRestrictedImports: the integration test creates an isolated workspace and prompt catalog.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult } from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { generated, tool } from "./chat-loop-test-support.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { AgentService } from "./service.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

async function definitions(root: string): Promise<MarkdownDefinitionLibrary> {
  const prompts = join(root, "prompts");
  await Promise.all([
    mkdir(join(prompts, "agents"), { recursive: true }),
    mkdir(join(prompts, "skills"), { recursive: true }),
  ]);
  await writeFile(
    join(prompts, "agents", "primary.md"),
    "---\nname: primary\ndescription: Test agent.\nmode: primary\ntools: [python]\ntemperature: 0\nsteps: 2\n---\nTest agent.",
  );
  return new MarkdownDefinitionLibrary(prompts);
}

function launcher(options = { artifact: "other.txt", exitCode: 0 }): CodeAgentLauncher {
  return {
    async openAgentSession() {
      return {
        async execute(request): Promise<AgentExecutionResult> {
          const evidence = {
            exitCode: options.exitCode,
            stdout: "",
            stderr: "",
            durationMs: 1,
            termination: "completed" as const,
            artifacts: [
              {
                name: options.artifact,
                mediaType: "text/plain",
                bytesBase64: Buffer.from(options.artifact).toString("base64"),
              },
            ],
          };
          if (request.language === "shell") {
            return {
              ...evidence,
              language: request.language,
              path: null,
              source: null,
              command: request.command,
            };
          }
          return {
            ...evidence,
            language: request.language,
            path: request.path,
            source: request.source,
            command: null,
          };
        },
        async cancel() {},
        async close() {},
      };
    },
    async deleteWorkspace() {},
  };
}

async function fixture(options?: { artifact: string; exitCode: number }) {
  const root = await mkdtemp(join(tmpdir(), "vault-artifact-completion-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const store = new AgentStore(catalog.database, artifacts);
  const results = [
    generated("", [tool("python", "create", { source: "print('ok')" })]),
    generated("Completed."),
  ];
  const service = new AgentService(
    catalog.database,
    store,
    conversations,
    new JobStore(catalog.database),
    artifacts,
    {
      async chat() {
        const result = results.shift();
        if (result === undefined) throw new Error("missing_chat_result");
        return result;
      },
    },
    launcher(options),
    new AuditLog(catalog.database),
    1,
    await definitions(root),
  );
  return { catalog, conversations, service };
}

async function terminal(service: AgentService, runId: string) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const snapshot = service.snapshot(runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 2));
  }
  throw new Error("agent_test_timeout");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("artifact completion lifecycle", () => {
  it("fails final missing output without publishing earlier artifacts", async () => {
    const { catalog, conversations, service } = await fixture();
    const run = service.start(conversations.createSession(null).id, "Create result.unknown.");
    const snapshot = await terminal(service, run.id);
    const trace = await service.trace(run.id);

    expect(snapshot.run).toMatchObject({
      state: "failed",
      error: "agent_required_artifacts_missing",
    });
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.events.map((event) => event.type)).not.toContain("assistant.completed");
    expect(trace.turns.at(-1)?.outcome).toBe("invalid_response");
    await service.close();
    catalog.close();
  });

  it("does not publish an artifact from a nonzero execution", async () => {
    const { catalog, conversations, service } = await fixture({
      artifact: "result.unknown",
      exitCode: 1,
    });
    const run = service.start(conversations.createSession(null).id, "Create result.unknown.");
    const snapshot = await terminal(service, run.id);
    const trace = await service.trace(run.id);

    expect(snapshot.run).toMatchObject({
      state: "failed",
      error: "agent_required_artifacts_missing",
    });
    expect(snapshot.executions[0]).toMatchObject({ state: "failed", exitCode: 1 });
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.events.map((event) => event.type)).not.toContain("assistant.completed");
    expect(trace.turns.at(-1)?.outcome).toBe("invalid_response");
    await service.close();
    catalog.close();
  });
});

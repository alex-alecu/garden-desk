// biome-ignore lint/style/noRestrictedImports: this containment test starts an isolated worker process.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: isolated persistence tests use owner-temporary state.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceWorkerRequestSchema } from "@gardendesk/shared";
import {
  InferenceWorkerClient,
  type NativeWorkerHandle,
  type NativeWorkerLauncher,
  type NativeWorkerLaunchRequest,
} from "@gardendesk/workers";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import type { AgentSessionManager } from "./session-manager.js";
import { AgentStore } from "./store.js";
import { runSubagent } from "./subagent-run.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "garden-desk-tool-persistence-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  return {
    catalog,
    jobs: new JobStore(catalog.database),
    sessions: new ConversationStore(catalog.database),
    store: new AgentStore(catalog.database, await ArtifactStore.create(scope)),
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused cases cover one migration boundary.
describe("agent tool persistence", () => {
  it("persists child-run and tool-event identity", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const parent = store.createRun(session.id, jobs.create("agent", "parent").id);
    const child = store.createRun(session.id, jobs.create("agent", "child").id, parent.id);
    store.appendEvent(child.id, "tool.started", "Reading the workspace.", {
      toolName: "read",
      toolCallId: "call-1",
    });

    expect(catalog.schemaVersion).toBe(13);
    expect(store.snapshot(child.id)).toMatchObject({
      run: { parentRunId: parent.id },
      events: [{ type: "tool.started", toolName: "read", toolCallId: "call-1" }],
    });
    catalog.close();
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: one case proves the rebuilt SQL checks together.
  it("accepts future execution languages and chat trace outcomes in SQLite", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const run = store.createRun(session.id, jobs.create("agent", "generic-tool").id);
    const now = new Date().toISOString();
    catalog.database
      .prepare(
        "INSERT INTO agent_executions (id, run_id, sequence, language, state, created_at, updated_at) VALUES (?, ?, 0, 'generic-tool', 'starting', ?, ?)",
      )
      .run(randomUUID(), run.id, now, now);
    const insertTurn = catalog.database.prepare(
      "INSERT INTO agent_inference_turns (id, run_id, sequence, phase, request_id, job_id, model_id, context_size, max_tokens, prompt_hash, schema_hash, outcome, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 'test', 'auto', 1024, 'prompt', 'schema', ?, ?, ?)",
    );
    insertTurn.run(
      randomUUID(),
      run.id,
      0,
      "chat",
      randomUUID(),
      run.jobId,
      "accepted_tool_calls",
      now,
      now,
    );
    insertTurn.run(
      randomUUID(),
      run.id,
      1,
      "compaction",
      randomUUID(),
      run.jobId,
      "accepted_compaction",
      now,
      now,
    );

    expect(
      catalog.database
        .prepare("SELECT language FROM agent_executions WHERE run_id = ?")
        .get(run.id),
    ).toEqual({ language: "generic-tool" });
    expect(
      catalog.database
        .prepare(
          "SELECT phase, outcome FROM agent_inference_turns WHERE run_id = ? ORDER BY sequence",
        )
        .all(run.id),
    ).toEqual([
      { phase: "chat", outcome: "accepted_tool_calls" },
      { phase: "compaction", outcome: "accepted_compaction" },
    ]);
    catalog.close();
  });
});

const PRIVATE_STDERR_SENTINEL = "private-worker-stderr-sentinel";
const WORKER_CRASH_MESSAGE = "Inference worker stopped.";
const probeRequest = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "subagent-stderr-test",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "probe",
  authorityProbePath: "/private/denied",
  outOfScopeReadPath: "/private/denied-read",
  outOfScopeWritePath: "/private/denied-write",
});

class CrashLauncher implements NativeWorkerLauncher {
  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `process.stdin.once("data", () => { process.stderr.write(${JSON.stringify(
          PRIVATE_STDERR_SENTINEL,
        )}); setTimeout(() => process.exit(7), 10); });`,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    return {
      process: child,
      async dispose() {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
    };
  }
}

function enableDevelopmentDiagnostics(root: string): () => void {
  const globals = globalThis as typeof globalThis & {
    __GARDEN_DESK_DEVELOPMENT_BUILD__?: boolean;
    __GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__?: string;
  };
  const build = globals.__GARDEN_DESK_DEVELOPMENT_BUILD__;
  const diagnosticRoot = globals.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__;
  globals.__GARDEN_DESK_DEVELOPMENT_BUILD__ = true;
  globals.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__ = root;
  return () => {
    if (build === undefined) delete globals.__GARDEN_DESK_DEVELOPMENT_BUILD__;
    else globals.__GARDEN_DESK_DEVELOPMENT_BUILD__ = build;
    if (diagnosticRoot === undefined) delete globals.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__;
    else globals.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__ = diagnosticRoot;
  };
}

async function subagentLibrary(root: string): Promise<MarkdownDefinitionLibrary> {
  const prompts = join(root, "prompts");
  await Promise.all([
    mkdir(join(prompts, "agents"), { recursive: true }),
    mkdir(join(prompts, "skills"), { recursive: true }),
    mkdir(join(prompts, "system"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(prompts, "agents", "general.md"),
      "---\nname: general\ndescription: Test sub-agent.\nmode: subagent\ntools: [list]\ntemperature: 0\nsteps: 1\n---\nTest sub-agent.",
    ),
    writeFile(join(prompts, "system", "general.md"), "Test system prompt."),
  ]);
  return new MarkdownDefinitionLibrary(prompts);
}

async function diagnosticOutput(root: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      for (const run of await readdir(root)) {
        const output = await readFile(join(root, run, "worker-stderr.log"));
        if (output.length > 0) return output;
      }
    } catch {
      // The development write is deliberately asynchronous.
    }
    await new Promise((accept) => setTimeout(accept, 10));
  }
  throw new Error("diagnostic output is missing");
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function childRunId(catalog: Fixture["catalog"], parentRunId: string): string {
  const row = catalog.database
    .prepare("SELECT id FROM agent_runs WHERE parent_run_id = ?")
    .get(parentRunId) as { id: string } | undefined;
  if (row === undefined) throw new Error("sub-agent run is missing");
  return row.id;
}

async function crashChild(
  input: Fixture,
  root: string,
): Promise<{ error: unknown; parentRunId: string }> {
  const session = input.sessions.createSession(null);
  const parent = input.store.createRun(session.id, input.jobs.create("agent", randomUUID()).id);
  const inference = {
    async chat() {
      return (await new InferenceWorkerClient(new CrashLauncher(), "unused").execute({
        request: probeRequest,
        memoryBudgetBytes: 1_024,
        timeoutMs: 1_000,
      })) as never;
    },
  };
  try {
    await runSubagent(
      {
        contextTokens: 512,
        database: input.catalog.database,
        inference,
        inspectImage: async () => "unused",
        jobs: input.jobs,
        library: await subagentLibrary(root),
        modelId: "test-model",
        parentRunId: parent.id,
        sessionId: session.id,
        sessions: {} as AgentSessionManager,
        signal: new AbortController().signal,
        store: input.store,
      },
      { description: "Test containment.", prompt: "Test containment.", subagentType: "general" },
    );
  } catch (error) {
    return { error, parentRunId: parent.id };
  }
  throw new Error("sub-agent crash did not reject");
}

describe("sub-agent worker stderr containment", () => {
  it("keeps private worker stderr only in the development sink after a crash", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-subagent-stderr-"));
    roots.push(root);
    const diagnosticRoot = join(root, "inference-diagnostics");
    const restoreDiagnostics = enableDevelopmentDiagnostics(diagnosticRoot);
    const input = await fixture();
    try {
      const { error: thrown, parentRunId } = await crashChild(input, root);
      const snapshot = input.store.snapshot(childRunId(input.catalog, parentRunId));
      const persisted = JSON.stringify({ events: snapshot.events, run: snapshot.run });
      const output = await diagnosticOutput(diagnosticRoot);

      expect(thrown).toMatchObject({ code: "worker_crash", message: WORKER_CRASH_MESSAGE });
      expect(String((thrown as Error).message)).not.toContain(PRIVATE_STDERR_SENTINEL);
      expect(snapshot.run).toMatchObject({ state: "failed", error: WORKER_CRASH_MESSAGE });
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({ stderr: WORKER_CRASH_MESSAGE, type: "run.failed" }),
      );
      expect(persisted).not.toContain(PRIVATE_STDERR_SENTINEL);
      expect(output.toString("utf8")).toContain(PRIVATE_STDERR_SENTINEL);
    } finally {
      restoreDiagnostics();
      input.catalog.close();
    }
  });
});

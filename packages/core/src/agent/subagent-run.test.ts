// biome-ignore lint/style/noRestrictedImports: this containment test starts an isolated worker process.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: this containment test creates an isolated catalog and worker process.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceWorkerRequestSchema } from "@vault/shared";
import {
  InferenceWorkerClient,
  type NativeWorkerHandle,
  type NativeWorkerLauncher,
  type NativeWorkerLaunchRequest,
} from "@vault/workers";
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

const PRIVATE_STDERR_SENTINEL = "private-worker-stderr-sentinel";
const PRIVATE_LAUNCH_SENTINEL = "private-worker-launch-sentinel";
const WORKER_CRASH_MESSAGE = "Inference worker stopped.";
const roots: string[] = [];
const probeRequest = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "subagent-stderr-test",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "probe",
  authorityProbePath: "/private/denied",
  outOfScopeReadPath: "/private/denied-read",
  outOfScopeWritePath: "/private/denied-write",
});

const chatRequest = InferenceWorkerRequestSchema.parse({
  protocolVersion: 2,
  requestId: "subagent-launch-test",
  jobId: "00000000-0000-4000-8000-000000000001",
  operation: "chat",
  modelId: "test-model",
  messages: [{ role: "user", text: "Test." }],
  tools: [],
  contextSize: 512,
  maxTokens: 1,
  temperature: 0,
});

interface DevelopmentDiagnosticGlobals {
  __VAULT_DEVELOPMENT_BUILD__?: boolean;
  __VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__?: string;
}

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

class FailingLauncher implements NativeWorkerLauncher {
  async launch(_request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    throw new Error(PRIVATE_LAUNCH_SENTINEL);
  }
}

function diagnosticGlobals(): DevelopmentDiagnosticGlobals {
  return globalThis as typeof globalThis & DevelopmentDiagnosticGlobals;
}

function enableDevelopmentDiagnostics(root: string): () => void {
  const globals = diagnosticGlobals();
  const build = globals.__VAULT_DEVELOPMENT_BUILD__;
  const diagnosticRoot = globals.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__;
  globals.__VAULT_DEVELOPMENT_BUILD__ = true;
  globals.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__ = root;
  return () => {
    if (build === undefined) delete globals.__VAULT_DEVELOPMENT_BUILD__;
    else globals.__VAULT_DEVELOPMENT_BUILD__ = build;
    if (diagnosticRoot === undefined) delete globals.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__;
    else globals.__VAULT_DEVELOPMENT_DIAGNOSTIC_ROOT__ = diagnosticRoot;
  };
}

async function definitions(root: string): Promise<MarkdownDefinitionLibrary> {
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

async function diagnosticOutput(root: string, name = "worker-stderr.log"): Promise<Buffer> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      for (const run of await readdir(root)) {
        const output = await readFile(join(root, run, name));
        if (output.length > 0) return output;
      }
    } catch {
      // The development write is deliberately asynchronous.
    }
    await new Promise((accept) => setTimeout(accept, 5));
  }
  throw new Error("diagnostic output is missing");
}

async function fixture(root: string) {
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const conversations = new ConversationStore(catalog.database);
  const jobs = new JobStore(catalog.database);
  const store = new AgentStore(catalog.database, artifacts);
  const session = conversations.createSession(null);
  const parentJob = jobs.create("agent", randomUUID());
  const parent = store.createRun(session.id, parentJob.id);
  return { catalog, jobs, library: await definitions(root), parent, session, store };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function crashingInference(client: InferenceWorkerClient, request = probeRequest) {
  return {
    async chat() {
      return (await client.execute({
        request,
        memoryBudgetBytes: 1_024,
        timeoutMs: 1_000,
      })) as never;
    },
  };
}

async function crashChild(
  input: Fixture,
  launcher: NativeWorkerLauncher = new CrashLauncher(),
  request = probeRequest,
): Promise<unknown> {
  try {
    await runSubagent(
      {
        contextTokens: 512,
        database: input.catalog.database,
        inference: crashingInference(new InferenceWorkerClient(launcher, "unused"), request),
        inspectImage: async () => "unused",
        jobs: input.jobs,
        library: input.library,
        modelId: "test-model",
        parentRunId: input.parent.id,
        sessionId: input.session.id,
        sessions: {} as AgentSessionManager,
        signal: new AbortController().signal,
        store: input.store,
      },
      { description: "Test containment.", prompt: "Test containment.", subagentType: "general" },
    );
  } catch (error) {
    return error;
  }
  throw new Error("sub-agent crash did not reject");
}

function childRunId(input: Fixture): string {
  const row = input.catalog.database
    .prepare("SELECT id FROM agent_runs WHERE parent_run_id = ?")
    .get(input.parent.id) as { id: string } | undefined;
  if (row === undefined) throw new Error("sub-agent run is missing");
  return row.id;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => await rm(root, { recursive: true, force: true })),
  );
});

describe("sub-agent worker stderr containment", () => {
  it("keeps private worker stderr only in the development sink after a crash", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-subagent-stderr-"));
    roots.push(root);
    const diagnosticRoot = join(root, "inference-diagnostics");
    const restoreDiagnostics = enableDevelopmentDiagnostics(diagnosticRoot);
    const input = await fixture(root);
    try {
      const thrown = await crashChild(input);
      const snapshot = input.store.snapshot(childRunId(input));
      const persisted = JSON.stringify({ events: snapshot.events, run: snapshot.run });
      const output = await diagnosticOutput(diagnosticRoot);

      expect(thrown).toMatchObject({ code: "worker_crash", message: WORKER_CRASH_MESSAGE });
      expect(String((thrown as Error).message)).not.toContain(PRIVATE_STDERR_SENTINEL);
      expect(snapshot.run).toMatchObject({ state: "failed", error: WORKER_CRASH_MESSAGE });
      expect(snapshot.events).toContainEqual(
        expect.objectContaining({
          stderr: WORKER_CRASH_MESSAGE,
          type: "run.failed",
        }),
      );
      expect(persisted).not.toContain(PRIVATE_STDERR_SENTINEL);
      expect(output.toString("utf8")).toContain(PRIVATE_STDERR_SENTINEL);
    } finally {
      restoreDiagnostics();
      input.catalog.close();
    }
  });
});

describe("sub-agent worker launch containment", () => {
  it("keeps private launch data only in the development host sink", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-subagent-launch-"));
    roots.push(root);
    const diagnosticRoot = join(root, "inference-diagnostics");
    const restoreDiagnostics = enableDevelopmentDiagnostics(diagnosticRoot);
    const input = await fixture(root);
    try {
      const thrown = await crashChild(input, new FailingLauncher(), chatRequest);
      const snapshot = input.store.snapshot(childRunId(input));
      const persisted = JSON.stringify({ events: snapshot.events, run: snapshot.run });
      const output = await diagnosticOutput(diagnosticRoot, "inference-host.log");

      expect(thrown).toMatchObject({ code: "worker_crash", message: WORKER_CRASH_MESSAGE });
      expect(String((thrown as Error).message)).not.toContain(PRIVATE_LAUNCH_SENTINEL);
      expect(snapshot.run).toMatchObject({ state: "failed", error: WORKER_CRASH_MESSAGE });
      expect(persisted).not.toContain(PRIVATE_LAUNCH_SENTINEL);
      expect(output.toString("utf8")).toContain(
        "[vault-inference] host stage=worker_launch operation=chat failed",
      );
      expect(output.toString("utf8")).toContain(`message=${PRIVATE_LAUNCH_SENTINEL}`);
    } finally {
      restoreDiagnostics();
      input.catalog.close();
    }
  });
});

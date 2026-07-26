import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { request } from "@vault/cli/client";
import { createVaultCore, startDaemon, type VaultDaemon } from "@vault/core";
import {
  type AgentRunSnapshot,
  AgentRunSnapshotSchema,
  AgentRunSummarySchema,
  type AgentTrace,
  AgentTraceSchema,
  FolderSummarySchema,
  ModelRuntimeStatusSchema,
  type RpcResponse,
  SessionSummarySchema,
} from "@vault/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";
import type { PreparedStressCase } from "./small-profile.js";

const repositoryRoot = process.cwd();
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const modelPath = join(modelRoot, "gemma-4-12b-it-qat-q4_0.gguf");
const helper = join(
  repositoryRoot,
  "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper",
);
const images = join(repositoryRoot, "packages/workers/images");

interface ActiveCase {
  fixture: PreparedStressCase;
  folderId: string;
  sessionId: string;
  runId: string;
  startedAt: number;
}

export interface StressCaseResult {
  id: string;
  passed: boolean;
  fixtureMs: number;
  fixtureBytes: number;
  fixtureFiles: number;
  runMs: number;
  state: string;
  executions: number;
  executionMs: number;
  expectedTokens: string[];
  missingTokens: string[];
  error: string | null;
}

export interface StressRunEvidence {
  result: StressCaseResult;
  snapshot: AgentRunSnapshot;
  trace: AgentTrace;
}

export interface StressRuntime {
  endpoint: string;
  daemon: VaultDaemon;
  core: Awaited<ReturnType<typeof createVaultCore>>;
}

let rpcId = 0;

async function rpc(endpoint: string, method: string, params: Record<string, unknown>) {
  const response = await request(endpoint, { id: ++rpcId, method, params });
  if ("error" in response) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.result;
}

export async function expectRpcFailure(
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
  code: string,
): Promise<void> {
  const response: RpcResponse = await request(endpoint, { id: ++rpcId, method, params });
  if (!("error" in response) || response.error.code !== code) {
    throw new Error(`Expected ${method} to fail with ${code}: ${JSON.stringify(response)}`);
  }
}

export async function prepareModelStore(): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const model = manifest.models.find((candidate) => candidate.id === "gemma-4-12b-it-qat-q4_0");
  if (model === undefined) throw new Error("Canonical M3 model is missing.");
  await verifyModelFile(model, modelPath);
  await writeFile(
    join(modelRoot, "installed-models.json"),
    JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          modelId: model.id,
          sha256: model.sha256,
          byteLength: model.byteLength,
          runtimeBuild: "node-llama-cpp@3.19.0",
          storeKey: basename(modelPath),
          installedAt: new Date().toISOString(),
        },
      ],
    }),
  );
}

export async function startStressRuntime(workspace: string): Promise<StressRuntime> {
  await mkdir(workspace);
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
  });
  try {
    const daemon = await startDaemon(core, workspace);
    return { core, daemon, endpoint: daemon.endpoint };
  } catch (error) {
    await core.close();
    throw error;
  }
}

export async function requireRealModel(endpoint: string, ready = true) {
  const status = ModelRuntimeStatusSchema.parse(await rpc(endpoint, "model.status", {}));
  if (status.modelId !== "gemma-4-12b-it-qat-q4_0" || (ready && status.state !== "ready")) {
    throw new Error(`Full Gemma model is not ready: ${JSON.stringify(status)}`);
  }
  return status;
}

export async function startCase(
  endpoint: string,
  fixture: PreparedStressCase,
): Promise<ActiveCase> {
  const folder = FolderSummarySchema.parse(
    await rpc(endpoint, "folders.add", { rootPath: fixture.source }),
  );
  const session = SessionSummarySchema.parse(
    await rpc(endpoint, "sessions.create", { folderId: folder.id }),
  );
  const run = AgentRunSummarySchema.parse(
    await rpc(endpoint, "agent.start", { sessionId: session.id, task: fixture.task }),
  );
  return {
    fixture,
    folderId: folder.id,
    sessionId: session.id,
    runId: run.id,
    startedAt: performance.now(),
  };
}

async function pollRun(endpoint: string, runId: string): Promise<AgentRunSnapshot> {
  return AgentRunSnapshotSchema.parse(await rpc(endpoint, "agent.get", { runId }));
}

function terminal(snapshot: AgentRunSnapshot): boolean {
  return snapshot.run.state !== "queued" && snapshot.run.state !== "running";
}

export async function awaitCases(
  endpoint: string,
  cases: ActiveCase[],
  deadlineMs: number,
): Promise<{ snapshots: Map<string, AgentRunSnapshot>; maximumRunning: number }> {
  const deadline = performance.now() + deadlineMs;
  const snapshots = new Map<string, AgentRunSnapshot>();
  let maximumRunning = 0;
  while (snapshots.size < cases.length && performance.now() < deadline) {
    const polled = await Promise.all(
      cases.map(async (item) => ({ item, snapshot: await pollRun(endpoint, item.runId) })),
    );
    maximumRunning = Math.max(
      maximumRunning,
      polled.filter(({ snapshot }) => snapshot.run.state === "running").length,
    );
    for (const { item, snapshot } of polled)
      if (terminal(snapshot)) snapshots.set(item.runId, snapshot);
    if (snapshots.size < cases.length) await new Promise((accept) => setTimeout(accept, 1_000));
  }
  if (snapshots.size !== cases.length) {
    throw new Error(`Stress cases timed out after ${Math.round(deadlineMs / 60_000)} minutes.`);
  }
  return { snapshots, maximumRunning };
}

function combinedOutput(snapshot: AgentRunSnapshot): string {
  return [
    snapshot.run.response ?? "",
    ...snapshot.executions.map((execution) => execution.stdout),
    ...snapshot.executions.map((execution) => execution.stderr),
  ].join("\n");
}

function outputHasToken(output: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}(?:\\.0+)?[\\t ]*(?:$|\\n)`, "u").test(output);
}

function measuredRunMs(active: ActiveCase, snapshot: AgentRunSnapshot): number {
  const catalogMs = Date.parse(snapshot.run.updatedAt) - Date.parse(snapshot.run.createdAt);
  return Number.isFinite(catalogMs) && catalogMs >= 0
    ? catalogMs
    : Math.round(performance.now() - active.startedAt);
}

function resultFor(active: ActiveCase, snapshot: AgentRunSnapshot): StressCaseResult {
  const output = combinedOutput(snapshot);
  const missingTokens = active.fixture.expectedTokens.filter(
    (token) => !outputHasToken(output, token),
  );
  const tooManyExecutions =
    active.fixture.maxExecutions !== undefined &&
    snapshot.executions.length > active.fixture.maxExecutions;
  const error = tooManyExecutions
    ? `Expected at most ${active.fixture.maxExecutions} executions.`
    : snapshot.run.error;
  return {
    id: active.fixture.id,
    passed: snapshot.run.state === "succeeded" && missingTokens.length === 0 && error === null,
    fixtureMs: active.fixture.fixtureMs,
    fixtureBytes: active.fixture.evidence.bytes,
    fixtureFiles: active.fixture.evidence.files,
    runMs: measuredRunMs(active, snapshot),
    state: snapshot.run.state,
    executions: snapshot.executions.length,
    executionMs: snapshot.executions.reduce(
      (total, execution) => total + (execution.durationMs ?? 0),
      0,
    ),
    expectedTokens: active.fixture.expectedTokens,
    missingTokens,
    error,
  };
}

export async function collectEvidence(
  endpoint: string,
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
): Promise<StressRunEvidence> {
  const trace = AgentTraceSchema.parse(await rpc(endpoint, "agent.trace", { runId: active.runId }));
  return { result: resultFor(active, snapshot), snapshot, trace };
}

export async function cleanupCase(endpoint: string, active: ActiveCase): Promise<void> {
  await rpc(endpoint, "folders.revoke", { folderId: active.folderId });
  await rpc(endpoint, "sessions.delete", { sessionId: active.sessionId });
}

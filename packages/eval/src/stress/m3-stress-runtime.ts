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
  parseWorkProgress,
  type RpcResponse,
  SessionSummarySchema,
  workContinuationMessage,
} from "@vault/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";
import { verifyDeliverables } from "./deliverable-verification.js";
import type { PreparedStressCase } from "./document-workloads.js";
import { createProgressReporter, stressResultFor, terminal } from "./m3-stress-reporting.js";
import { stressPlatform } from "./stress-platform.js";

const repositoryRoot = process.cwd();
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const modelPath = join(modelRoot, "gemma-4-12b-it-qat-q4_0.gguf");
const images = join(repositoryRoot, "packages/workers/images");

export interface ActiveCase {
  fixture: PreparedStressCase;
  folderId: string;
  previousSnapshots: AgentRunSnapshot[];
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
  producedArtifacts: string[];
  error: string | null;
  verifiedDeliverables: string[];
  verificationOutput: string;
  contextCompactions: number;
}

export interface StressRunEvidence {
  previousRuns: Array<{ snapshot: AgentRunSnapshot; trace: AgentTrace }>;
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
  const platform = await stressPlatform();
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: platform.helper,
    agentImageRoot: images,
    ...(platform.inference ?? {}),
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
    previousSnapshots: [],
    sessionId: session.id,
    runId: run.id,
    startedAt: performance.now(),
  };
}

async function pollRun(endpoint: string, runId: string): Promise<AgentRunSnapshot> {
  return AgentRunSnapshotSchema.parse(await rpc(endpoint, "agent.get", { runId }));
}

function continuationProgress(snapshot: AgentRunSnapshot) {
  if (snapshot.run.state !== "succeeded" || snapshot.run.response === null) return undefined;
  const progress = snapshot.executions
    .map((execution) => parseWorkProgress(execution.stdout))
    .filter((item) => item !== undefined && !item.complete)
    .at(-1);
  return progress !== undefined && snapshot.run.response === workContinuationMessage(progress)
    ? progress
    : undefined;
}

async function continueCase(endpoint: string, active: ActiveCase, snapshot: AgentRunSnapshot) {
  const progress = continuationProgress(snapshot);
  if (progress === undefined) return false;
  active.previousSnapshots.push(snapshot);
  const run = AgentRunSummarySchema.parse(
    await rpc(endpoint, "agent.start", { sessionId: active.sessionId, task: "Continue" }),
  );
  console.log(
    JSON.stringify({
      phase: "case.continue",
      id: active.fixture.id,
      previousRunId: active.runId,
      runId: run.id,
      done: progress.done,
      total: progress.total,
    }),
  );
  active.runId = run.id;
  return true;
}

interface PolledCase {
  item: ActiveCase;
  snapshot: AgentRunSnapshot;
}

async function pollCases(endpoint: string, cases: ActiveCase[]): Promise<PolledCase[]> {
  return Promise.all(
    cases.map(async (item) => ({ item, snapshot: await pollRun(endpoint, item.runId) })),
  );
}

async function recordPoll(
  endpoint: string,
  polled: PolledCase[],
  report: (active: ActiveCase, snapshot: AgentRunSnapshot) => void,
  snapshots: Map<string, AgentRunSnapshot>,
): Promise<void> {
  for (const { item, snapshot } of polled) {
    report(item, snapshot);
    if (await continueCase(endpoint, item, snapshot)) continue;
    if (terminal(snapshot)) snapshots.set(item.runId, snapshot);
  }
}

export async function awaitCases(
  endpoint: string,
  cases: ActiveCase[],
  deadlineMs: number,
): Promise<{ snapshots: Map<string, AgentRunSnapshot>; maximumRunning: number }> {
  const deadline = performance.now() + deadlineMs;
  const snapshots = new Map<string, AgentRunSnapshot>();
  const report = createProgressReporter();
  let maximumRunning = 0;
  while (snapshots.size < cases.length && performance.now() < deadline) {
    const polled = await pollCases(endpoint, cases);
    maximumRunning = Math.max(
      maximumRunning,
      polled.filter(({ snapshot }) => snapshot.run.state === "running").length,
    );
    await recordPoll(endpoint, polled, report, snapshots);
    if (snapshots.size < cases.length) await new Promise((accept) => setTimeout(accept, 1_000));
  }
  if (snapshots.size !== cases.length) {
    throw new Error(`Stress cases timed out after ${Math.round(deadlineMs / 60_000)} minutes.`);
  }
  return { snapshots, maximumRunning };
}

export async function collectEvidence(
  endpoint: string,
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
): Promise<StressRunEvidence> {
  const trace = AgentTraceSchema.parse(await rpc(endpoint, "agent.trace", { runId: active.runId }));
  const previousRuns = await Promise.all(
    active.previousSnapshots.map(async (previous) => ({
      snapshot: previous,
      trace: AgentTraceSchema.parse(await rpc(endpoint, "agent.trace", { runId: previous.run.id })),
    })),
  );
  const verification = await verifyDeliverables(
    (method, params) => rpc(endpoint, method, params),
    active,
    snapshot,
    async (verifying) => {
      const awaited = await awaitCases(endpoint, [verifying as ActiveCase], 15 * 60_000);
      return awaited.snapshots.get(verifying.runId);
    },
  );
  return {
    previousRuns,
    result: stressResultFor(active, snapshot, {
      verified: verification.verified,
      output: verification.output,
      trace,
    }),
    snapshot,
    trace,
  };
}

export async function cleanupCase(endpoint: string, active: ActiveCase): Promise<void> {
  await rpc(endpoint, "folders.revoke", { folderId: active.folderId });
  await rpc(endpoint, "sessions.delete", { sessionId: active.sessionId });
}

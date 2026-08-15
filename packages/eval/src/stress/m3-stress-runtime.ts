import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
import { prepareAgentModelStore } from "../gates/agent-model-store.js";
import { verifyDeliverables } from "./deliverable-verification.js";
import type { ExpectedTableRow, PreparedStressCase } from "./document-workloads.js";
import { createProgressReporter, stressResultFor, terminal } from "./m3-stress-reporting.js";
import { stressPlatform } from "./stress-platform.js";

const repositoryRoot = process.cwd();
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
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
  failedExecutions: number;
  executionMs: number;
  inferenceFailures: number;
  expectedTokens: string[];
  forbiddenResponseText: string[];
  presentForbiddenResponseText: string[];
  requiredExecutionText: string[];
  missingExecutionText: string[];
  requiredSkills: string[];
  missingSkills: string[];
  requiredSkillSequence: string[];
  firstLoadedSkills: string[];
  skillOrderValid: boolean;
  forbiddenSkills: string[];
  calledForbiddenSkills: string[];
  missingTokens: string[];
  missingTableRows: ExpectedTableRow[];
  producedArtifacts: string[];
  error: string | null;
  retainedArtifacts: string[];
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
  await prepareAgentModelStore(modelRoot);
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
    visionRuntimePath: platform.visionRuntimePath,
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

interface PolledCase {
  item: ActiveCase;
  snapshot: AgentRunSnapshot;
}

async function pollCases(endpoint: string, cases: ActiveCase[]): Promise<PolledCase[]> {
  return Promise.all(
    cases.map(async (item) => ({ item, snapshot: await pollRun(endpoint, item.runId) })),
  );
}

function recordPoll(
  polled: PolledCase[],
  report: (active: ActiveCase, snapshot: AgentRunSnapshot) => void,
  snapshots: Map<string, AgentRunSnapshot>,
): void {
  for (const { item, snapshot } of polled) {
    report(item, snapshot);
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
    recordPoll(polled, report, snapshots);
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
      retained: verification.retained,
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

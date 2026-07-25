import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createVaultCore, resolveInferenceHardwarePolicy } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";
import { runMacOsGuestEvidence } from "./m3-macos-guest.js";

const repositoryRoot = process.cwd();
const helper = join(
  repositoryRoot,
  "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper",
);
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const modelPath = join(modelRoot, "gemma-4-12b-it-qat-q4_0.gguf");
type RealLanguage = "python" | "node";

async function prepareModelStore(): Promise<void> {
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

async function awaitConcurrentRuns(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  runs: { language: RealLanguage; id: string }[],
  deadlineMs: number,
): Promise<{
  maximumWorking: number;
  snapshots: Map<RealLanguage, AgentRunSnapshot>;
}> {
  const deadline = performance.now() + deadlineMs;
  const snapshots = new Map<RealLanguage, AgentRunSnapshot>();
  let maximumWorking = 0;
  while (snapshots.size < runs.length && performance.now() < deadline) {
    const polled = await Promise.all(
      runs
        .filter((run) => !snapshots.has(run.language))
        .map(async (run) => ({ ...run, snapshot: await core.getAgentRun(run.id) })),
    );
    const working = polled.filter(
      ({ snapshot }) => snapshot.run.state === "queued" || snapshot.run.state === "running",
    ).length;
    for (const { language, snapshot } of polled) {
      if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") {
        snapshots.set(language, snapshot);
      }
    }
    maximumWorking = Math.max(maximumWorking, working);
    await new Promise((accept) => setTimeout(accept, 500));
  }
  if (snapshots.size !== runs.length) {
    throw new Error(`Concurrent real agent runs timed out: ${JSON.stringify([...snapshots])}`);
  }
  if (maximumWorking < 2) throw new Error("Real agent conversations did not overlap.");
  return { maximumWorking, snapshots };
}

async function automaticModelEvidence(core: Awaited<ReturnType<typeof createVaultCore>>) {
  const model = await core.modelStatus();
  const policy = resolveInferenceHardwarePolicy("auto");
  if (
    !policy.supported ||
    model.state !== "ready" ||
    model.memoryBudgetBytes !== policy.memoryBudgetBytes ||
    (model.cpuRamBytes ?? 0) + (model.gpuVramBytes ?? 0) > policy.memoryBudgetBytes ||
    (model.contextSizeTokens ?? 0) <= 8_192
  ) {
    throw new Error(`Automatic model memory or context proof failed: ${JSON.stringify(model)}`);
  }
  return model;
}

async function requireMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Deleted session retained its workspace manifest: ${path}`);
}

async function workspaceLifecycleEvidence(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  workspace: string,
  sessionId: string,
  folderId: string,
) {
  const manifest = join(workspace, ".vault", "agent-workspaces", "manifests", `${sessionId}.json`);
  if (!(await stat(manifest)).isFile()) throw new Error("Agent workspace was not committed.");
  if (!(await core.revokeFolder(folderId))) throw new Error("Folder revocation proof failed.");
  if (!(await stat(manifest)).isFile()) throw new Error("Revocation deleted the workspace.");
  if (!(await core.deleteSession(sessionId))) throw new Error("Session deletion proof failed.");
  await requireMissing(manifest);
  return { folderRevocation: "workspace_retained", sessionDeletion: "workspace_removed" };
}

function requireRealAgentResult(snapshot: AgentRunSnapshot, language: RealLanguage) {
  const attempts = snapshot.events.filter((event) => event.type === "execution.completed");
  const executions = attempts.filter(
    (event) => event.language === language && event.termination === "completed",
  );
  if (
    snapshot.run.state !== "succeeded" ||
    executions.length < 2 ||
    !snapshot.artifacts.some((artifact) => artifact.name === `${language}-result.txt`)
  ) {
    throw new Error(`Real ${language} multi-step agent proof failed: ${JSON.stringify(snapshot)}`);
  }
  return { attempts, executions };
}

async function prepareRealAgent(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  root: string,
  language: RealLanguage,
) {
  const source = join(root, `${language}-source`);
  await mkdir(source);
  await writeFile(join(source, `${language}-input.txt`), "M3 passed");
  const folder = await core.addFolder(source);
  const session = await core.createSession(folder.id);
  return { folder, session, language };
}

async function collectRealAgentEvidence(input: {
  core: Awaited<ReturnType<typeof createVaultCore>>;
  workspace: string;
  target: Awaited<ReturnType<typeof prepareRealAgent>>;
  snapshot: AgentRunSnapshot;
  model: Awaited<ReturnType<typeof automaticModelEvidence>>;
}) {
  const { core, model, snapshot, target, workspace } = input;
  const { attempts, executions } = requireRealAgentResult(snapshot, target.language);
  const lifecycle = await workspaceLifecycleEvidence(
    core,
    workspace,
    target.session.id,
    target.folder.id,
  );
  return [
    target.language,
    {
      executions: executions.length,
      attempts: attempts.length,
      artifacts: snapshot.artifacts.length,
      memoryBudgetBytes: model.memoryBudgetBytes,
      cpuRamBytes: model.cpuRamBytes,
      gpuVramBytes: model.gpuVramBytes,
      contextSizeTokens: model.contextSizeTokens,
      ...lifecycle,
    },
  ] as const;
}

async function runRealAgents(root: string) {
  const workspace = join(root, "agent-workspace");
  await mkdir(workspace);
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
  });
  try {
    const targets = [
      await prepareRealAgent(core, root, "python"),
      await prepareRealAgent(core, root, "node"),
    ];
    const runs = await Promise.all(
      targets.map(async ({ language, session }) => ({
        language,
        ...(await core.startAgent(
          session.id,
          `Use exactly two separate source executions. Every execution must set language to ${language} and provide source and path; never choose shell or command. Execution 1: read /source/${language}-input.txt and print its exact contents. Execution 2: read it and write the exact contents to /workspace/${language}-result.txt. After one successful observation, do not repeat execution 1. Do not respond before both executions succeed.`,
        )),
      })),
    );
    const concurrent = await awaitConcurrentRuns(core, runs, 10 * 60_000);
    const model = await automaticModelEvidence(core);
    const results = Object.fromEntries(
      await Promise.all(
        targets.map(async (target) => {
          const snapshot = concurrent.snapshots.get(target.language);
          if (snapshot === undefined) throw new Error(`Missing ${target.language} agent result.`);
          return collectRealAgentEvidence({ core, workspace, target, snapshot, model });
        }),
      ),
    );
    return {
      maximumWorking: concurrent.maximumWorking,
      realPython: results.python,
      realNode: results.node,
    };
  } finally {
    await core.close();
  }
}

async function main(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("The certified M3 macOS gate requires Apple silicon.");
  }
  const root = await mkdtemp(join(tmpdir(), "vault-m3-agent-gate-"));
  try {
    const guest = await runMacOsGuestEvidence(root, helper, images);
    await prepareModelStore();
    const realAgents = await runRealAgents(root);
    console.log(
      JSON.stringify({
        classification: "certified",
        guest,
        ...realAgents,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createVaultCore } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";
import { MacOsMicroVmLauncher } from "@vault/workers";
import { prepareAgentModelStore } from "./agent-model-store.js";
import { developmentInferenceWorkerEntryPath } from "./development-inference-path.js";
import { macOsAgentOverlapEvidence } from "./m3-agent-process-overlap.js";
import {
  requireM3ProductCheck,
  requireM3RegularFile,
  runCanonicalGate,
} from "./m3-canonical-gate-reporting.js";
import { runGuestEvidence } from "./m3-guest.js";
import { realImageEvidence } from "./m3-image-agent.js";
import { automaticModelEvidence } from "./m3-macos-model-evidence.js";
import {
  requireSavedScriptRepairEvidence,
  type SavedScriptRequirement,
} from "./m3-saved-script-evidence.js";
import {
  macosSavedScriptRequirement,
  savedScriptRepairPrompt,
} from "./m3-saved-script-fixtures.js";

const repositoryRoot = process.cwd();
const helper = join(
  repositoryRoot,
  "packages/workers/native/macos-vz-helper/.generated/vault-vz-helper",
);
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const visionRuntime = join(
  repositoryRoot,
  "packages/eval/.generated/vision/macos-arm64/llama-mtmd-cli",
);
const imageFixture = join(repositoryRoot, "site/assets/product-icon.png");
type RealLanguage = "python" | "node";

function retainTerminalSnapshots(
  snapshots: Map<RealLanguage, AgentRunSnapshot>,
  polled: Array<{ language: RealLanguage; snapshot: AgentRunSnapshot }>,
): void {
  for (const { language, snapshot } of polled) {
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") {
      snapshots.set(language, snapshot);
    }
  }
}

async function awaitConcurrentRuns(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  runs: { language: RealLanguage; id: string }[],
  deadlineMs: number,
): Promise<{
  maximumOverlappingVms: number;
  snapshots: Map<RealLanguage, AgentRunSnapshot>;
}> {
  const deadline = performance.now() + deadlineMs;
  const snapshots = new Map<RealLanguage, AgentRunSnapshot>();
  while (snapshots.size < runs.length && performance.now() < deadline) {
    const polled = await Promise.all(
      runs.map(async (run) => ({ ...run, snapshot: await core.getAgentRun(run.id) })),
    );
    retainTerminalSnapshots(snapshots, polled);
    await new Promise((accept) => setTimeout(accept, 500));
  }
  if (snapshots.size !== runs.length) {
    throw new Error(`Concurrent real agent runs timed out: ${JSON.stringify([...snapshots])}`);
  }
  const refreshed = await Promise.all(
    runs.map(async (run) => ({ ...run, snapshot: await core.getAgentRun(run.id) })),
  );
  for (const { language, snapshot } of refreshed) snapshots.set(language, snapshot);
  return {
    ...macOsAgentOverlapEvidence([...snapshots.values()], Date.now()),
    snapshots,
  };
}

async function requireMissing(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  requireM3ProductCheck(false, `Deleted session retained its workspace manifest: ${path}`);
}

async function workspaceLifecycleEvidence(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  workspace: string,
  sessionId: string,
  folderId: string,
) {
  const manifest = join(workspace, ".vault", "agent-workspaces", "manifests", `${sessionId}.json`);
  await requireM3RegularFile(manifest, "Agent workspace was not committed.");
  requireM3ProductCheck(await core.revokeFolder(folderId), "Folder revocation proof failed.");
  await requireM3RegularFile(manifest, "Revocation deleted the workspace.");
  requireM3ProductCheck(await core.deleteSession(sessionId), "Session deletion proof failed.");
  await requireMissing(manifest);
  return { folderRevocation: "workspace_retained", sessionDeletion: "workspace_removed" };
}

function requireRealAgentResult(
  snapshot: AgentRunSnapshot,
  language: RealLanguage,
  savedScript: SavedScriptRequirement,
) {
  const attempts = snapshot.events.filter((event) => event.type === "execution.completed");
  const executions = attempts.filter(
    (event) => event.language === language && event.termination === "completed",
  );
  const repair = requireSavedScriptRepairEvidence(snapshot, savedScript);
  requireM3ProductCheck(
    snapshot.run.state === "succeeded" &&
      snapshot.artifacts.some((artifact) => artifact.name === `${language}-result.txt`),
    `Real ${language} multi-step agent proof failed: ${JSON.stringify(snapshot)}`,
  );
  return { attempts, executions, repair };
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
  const { attempts, executions, repair } = requireRealAgentResult(
    snapshot,
    target.language,
    macosSavedScriptRequirement(target.language),
  );
  const artifact = snapshot.artifacts.find((item) => item.name === `${target.language}-result.txt`);
  requireM3ProductCheck(artifact !== undefined, "Real agent result artifact is missing.");
  const materialized = await core.materializeArtifact(target.session.id, artifact.id);
  try {
    requireM3ProductCheck(
      (await readFile(materialized, "utf8")) === "M3 passed",
      "Real agent result artifact bytes do not match.",
    );
  } finally {
    await rm(dirname(materialized), { recursive: true, force: true });
  }
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
      artifactBytesVerified: true,
      artifactHash: artifact.contentHash,
      savedScriptRepair: repair,
      memoryBudgetBytes: model.memoryBudgetBytes,
      cpuRamBytes: model.cpuRamBytes,
      gpuMemoryBytes: model.gpuMemoryBytes,
      contextSizeTokens: model.contextSizeTokens,
      ...lifecycle,
    },
  ] as const;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the development worker entry remains explicit.
async function runRealAgents(root: string) {
  const workspace = join(root, "agent-workspace");
  await mkdir(workspace);
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    workerEntryPath: developmentInferenceWorkerEntryPath(),
    visionRuntimePath: visionRuntime,
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
          savedScriptRepairPrompt(macosSavedScriptRequirement(language)),
        )),
      })),
    );
    const concurrent = await awaitConcurrentRuns(core, runs, 10 * 60_000);
    const model = await automaticModelEvidence(core);
    const results = Object.fromEntries(
      await Promise.all(
        targets.map(async (target) => {
          const snapshot = concurrent.snapshots.get(target.language);
          requireM3ProductCheck(snapshot !== undefined, `Missing ${target.language} agent result.`);
          return collectRealAgentEvidence({ core, workspace, target, snapshot, model });
        }),
      ),
    );
    const realImage = await realImageEvidence(core, imageFixture);
    const auditValid = await core.verifyAudit();
    requireM3ProductCheck(auditValid, "Real image audit chain failed.");
    return {
      auditValid,
      maximumOverlappingVms: concurrent.maximumOverlappingVms,
      realPython: results.python,
      realNode: results.node,
      realImage,
    };
  } finally {
    await core.close();
  }
}

await runCanonicalGate({
  failureClassification: "m3_macos_gate_failed",
  run: async (setFailureStage) => {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error("The certified M3 macOS gate requires Apple silicon.");
    }
    const root = await mkdtemp(join(tmpdir(), "vault-m3-agent-gate-"));
    try {
      await prepareAgentModelStore(modelRoot);
      setFailureStage("runtime_transport");
      const guest = await runGuestEvidence(
        root,
        (workspace) => new MacOsMicroVmLauncher(helper, images, workspace),
      );
      const realAgents = await runRealAgents(root);
      console.log(
        JSON.stringify({
          classification: "certified",
          failureClass: "passed",
          evidenceReference: null,
          guest,
          ...realAgents,
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
});

import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createVaultCore } from "@vault/core";
import { pollAgentRun, requireM3ProductCheck } from "./m3-canonical-gate-reporting.js";
import { requireSavedScriptRepairEvidence } from "./m3-saved-script-evidence.js";
import {
  savedScriptRepairPrompt,
  windowsSavedScriptRequirement,
} from "./m3-saved-script-fixtures.js";
import { developmentWindowsInferencePaths } from "./windows-inference.js";

const repositoryRoot = process.cwd();
const helper = join(
  repositoryRoot,
  "packages/workers/native/windows-hcs-helper/.generated/vault-hcs-helper.exe",
);
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");

async function awaitTerminal(core: Awaited<ReturnType<typeof createVaultCore>>, runId: string) {
  const deadline = performance.now() + 10 * 60_000;
  while (performance.now() < deadline) {
    const snapshot = await pollAgentRun(core, runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 350));
  }
  throw new Error(`Windows saved-script run timed out: ${runId}`);
}

async function verifyArtifact(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  sessionId: string,
  snapshot: Awaited<ReturnType<typeof awaitTerminal>>,
): Promise<string> {
  const artifact = snapshot.artifacts.find((item) => item.name === "windows-saved-repair.txt");
  requireM3ProductCheck(artifact !== undefined, "Windows saved-script artifact is missing.");
  const path = await core.materializeArtifact(sessionId, artifact.id);
  try {
    const text = await readFile(path, "utf8");
    requireM3ProductCheck(
      text === windowsSavedScriptRequirement.finalOutput,
      "Windows saved-script artifact bytes do not match.",
    );
    return artifact.contentHash;
  } finally {
    await rm(dirname(path), { recursive: true, force: true });
  }
}

export async function runWindowsSavedScriptRepairEvidence(root: string) {
  const source = join(root, "saved-script-source");
  const workspace = join(root, "saved-script-workspace");
  await Promise.all([mkdir(source), mkdir(workspace)]);
  const inference = await developmentWindowsInferencePaths();
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    ...inference,
  });
  try {
    const folder = await core.addFolder(source);
    const session = await core.createSession(folder.id);
    const run = await core.startAgent(
      session.id,
      savedScriptRepairPrompt(windowsSavedScriptRequirement),
    );
    const snapshot = await awaitTerminal(core, run.id);
    const savedScriptRepair = requireSavedScriptRepairEvidence(
      snapshot,
      windowsSavedScriptRequirement,
    );
    const artifactHash = await verifyArtifact(core, session.id, snapshot);
    const folderRevoked = await core.revokeFolder(folder.id);
    requireM3ProductCheck(folderRevoked, "Windows saved-script folder revocation failed.");
    const auditValid = await core.verifyAudit();
    requireM3ProductCheck(auditValid, "Windows saved-script repair audit chain failed.");
    return {
      artifactHash,
      auditValid,
      folderRevoked,
      runState: snapshot.run.state,
      savedScriptRepair,
    };
  } finally {
    await core.close();
  }
}

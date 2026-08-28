import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultCore } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";
import { WindowsMicroVmLauncher } from "@vault/workers";
import { prepareAgentModelStore } from "./agent-model-store.js";
import { maximumAgentProcessOverlap } from "./m3-agent-process-overlap.js";
import {
  pollAgentRun,
  requireM3ProductCheck,
  runCanonicalGate,
} from "./m3-canonical-gate-reporting.js";
import { runGuestEvidence } from "./m3-guest.js";
import { realImageEvidence } from "./m3-image-agent.js";
import {
  boundedOutputEvidence,
  hasRunningExecution,
  hasRunningLiveMarker,
  hasTeardownOrBoundedExit,
  matchesTerminalAgentEvidence,
  selectedAgentEvidence,
} from "./m3-windows-agent-evidence.js";
import { runWindowsSavedScriptRepairEvidence } from "./m3-windows-saved-script.js";
import { developmentWindowsInferencePaths } from "./windows-inference.js";

const repositoryRoot = process.cwd();
const nativeRoot = join(repositoryRoot, "packages/workers/native");
const helper = join(nativeRoot, "windows-hcs-helper/.generated/vault-hcs-helper.exe");
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const imageFixture = join(repositoryRoot, "site/assets/product-icon.png");
type WindowsArtifacts = { initramfs: string; kernel: string };
interface AgentEvidenceInput {
  root: string;
  name: string;
  prompt: string;
  liveToken: string;
  finishToken?: string;
  cancel?: boolean;
  expectLiveOutput?: boolean;
  expectStdoutTruncated?: boolean;
}
async function windowsArtifacts(): Promise<WindowsArtifacts> {
  const manifest = JSON.parse(await readFile(join(images, "agent", "manifest.json"), "utf8")) as {
    outputs: { x86_64?: Record<string, string> };
  };
  const output = manifest.outputs.x86_64;
  if (
    output === undefined ||
    output.kernelSha256 === "pending" ||
    output.initramfsSha256 === "pending"
  ) {
    throw new Error("Build and hash the x86_64 agent image before running the Windows gate.");
  }
  const root = join(images, ".generated", "agent", "artifacts", "x86_64");
  const kernel = join(root, String(output.kernelFile));
  const initramfs = join(root, String(output.initramfsFile));
  return { kernel, initramfs };
}
async function awaitRun(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  runId: string,
  liveToken: string,
  cancel: boolean,
): Promise<{ snapshot: AgentRunSnapshot; live: boolean }> {
  const deadline = performance.now() + 10 * 60_000;
  let [live, cancelled] = [false, false];
  while (performance.now() < deadline) {
    const snapshot = await pollAgentRun(core, runId);
    if (hasRunningLiveMarker(snapshot, liveToken)) live = true;
    if (hasRunningExecution(snapshot) && cancel && !cancelled)
      cancelled = await core.cancelAgent(snapshot.run.jobId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running")
      return { snapshot, live };
    await new Promise((accept) => setTimeout(accept, 350));
  }
  throw new Error(`Windows agent run timed out: ${runId}`);
}
function requireAgentEvidence(
  result: { snapshot: AgentRunSnapshot; live: boolean },
  input: AgentEvidenceInput,
) {
  const request = {
    cancel: input.cancel ?? false,
    startToken: input.liveToken,
    ...(input.finishToken === undefined ? {} : { finishToken: input.finishToken }),
    stdoutTruncated: input.expectStdoutTruncated ?? false,
  };
  const execution = input.expectStdoutTruncated
    ? boundedOutputEvidence(result.snapshot, { startToken: input.liveToken })
    : selectedAgentEvidence(result.snapshot, request);
  requireM3ProductCheck(
    !((input.expectLiveOutput ?? true) && !result.live) &&
      execution !== undefined &&
      matchesTerminalAgentEvidence(result.snapshot, execution, request),
    `Windows agent proof failed: ${JSON.stringify(result.snapshot)}`,
  );
  return execution;
}
async function runAgentEvidence(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  input: AgentEvidenceInput,
) {
  const source = join(input.root, `${input.name}-source`);
  await mkdir(source);
  const folder = await core.addFolder(source);
  const session = await core.createSession(folder.id);
  const run = await core.startAgent(session.id, input.prompt);
  const result = await awaitRun(core, run.id, input.liveToken, input.cancel ?? false);
  const execution = requireAgentEvidence(result, input);
  const folderRevoked = await core.revokeFolder(folder.id);
  requireM3ProductCheck(folderRevoked, "Windows agent folder revocation failed.");
  const auditValid = await core.verifyAudit();
  requireM3ProductCheck(auditValid, "Windows agent audit chain failed.");
  const afterTeardown = await core.getAgentRun(run.id);
  const teardown = afterTeardown.executions.some((item) =>
    item.vmDiagnostics.some((diagnostic) => diagnostic.code === "teardown"),
  );
  requireM3ProductCheck(
    hasTeardownOrBoundedExit(afterTeardown, execution),
    "Windows HCS teardown diagnostic was not retained.",
  );
  return [
    {
      runState: result.snapshot.run.state,
      stdoutBytes: execution.stdoutBytes,
      stdoutTruncated: execution.stdoutTruncated,
      diagnostics: execution.vmDiagnostics.map((item) => item.code),
      auditValid,
      folderRevoked,
      teardown,
    },
    afterTeardown,
  ] as const;
}
async function runWindowsAgentEvidence(root: string) {
  const workspace = join(root, "agent-workspace");
  await mkdir(workspace);
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
    const concurrent = await runConcurrentAgentEvidence(core, root);
    const [cancellation] = await runAgentEvidence(core, {
      root,
      name: "cancel",
      prompt:
        "Execute exactly one Python source file. Print 'cancel-start' with flush=True, then sleep for 60 seconds.",
      liveToken: "cancel-start",
      cancel: true,
      expectLiveOutput: false,
    });
    const [limits] = await runAgentEvidence(core, {
      root,
      name: "limits",
      prompt:
        "Execute exactly one Python source file. Print 'limit-start' with flush=True, then print 1100000 letter x characters.",
      liveToken: "limit-start",
      expectLiveOutput: false,
      expectStdoutTruncated: true,
    });
    requireM3ProductCheck(
      limits.runState === "succeeded",
      `Windows bounded-observation proof failed: ${limits.runState}`,
    );
    return { ...concurrent, cancellation, limits };
  } finally {
    await core.close();
  }
}
async function runConcurrentAgentEvidence(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  root: string,
) {
  const [pythonResult, nodeResult] = await Promise.all([
    runAgentEvidence(core, {
      root,
      name: "python",
      prompt:
        "Execute exactly one Python source file. Print 'python-start' with flush=True, sleep for 3 seconds, then print 'python-finish' with flush=True. Do not respond before it finishes.",
      liveToken: "python-start",
      finishToken: "python-finish",
    }),
    runAgentEvidence(core, {
      root,
      name: "node",
      prompt:
        "Execute exactly one Node.js source file. Call process.stdout.write('node-start\\n'), wait 3 seconds, then call process.stdout.write('node-finish\\n'). Do not write these markers to a file. Do not respond before it finishes.",
      liveToken: "node-start",
      finishToken: "node-finish",
    }),
  ]);
  const [python, pythonSnapshot] = pythonResult;
  const [node, nodeSnapshot] = nodeResult;
  const maximumOverlappingProcesses = maximumAgentProcessOverlap([pythonSnapshot, nodeSnapshot]);
  requireM3ProductCheck(
    maximumOverlappingProcesses >= 2,
    "Real Windows agent process lifetimes did not overlap.",
  );
  return { python, node, maximumOverlappingProcesses };
}
async function runWindowsEvidence(root: string, artifacts: WindowsArtifacts) {
  const agent = await runWindowsAgentEvidence(root);
  const savedScriptRepair = await runWindowsSavedScriptRepairEvidence(root);
  const image = await runWindowsImageEvidence(root);
  const malformedFrames = await malformedFrameEvidence(root, artifacts);
  return { ...agent, savedScriptRepair, image, malformedFrames };
}
async function runWindowsImageEvidence(root: string): Promise<Record<string, unknown>> {
  const imageWorkspace = join(root, "image-workspace");
  await mkdir(imageWorkspace);
  const inference = await developmentWindowsInferencePaths();
  const imageCore = await createVaultCore({
    workspaceDir: imageWorkspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    ...inference,
  });
  try {
    const image = await realImageEvidence(imageCore, imageFixture);
    requireM3ProductCheck(await imageCore.verifyAudit(), "Real image audit chain failed.");
    return image;
  } finally {
    await imageCore.close();
  }
}
async function malformedFrameEvidence(root: string, artifacts: WindowsArtifacts) {
  const source = join(root, "malformed-source");
  await mkdir(source);
  const child = spawn(
    helper,
    [
      "--kernel",
      artifacts.kernel,
      "--initramfs",
      artifacts.initramfs,
      "--cpus",
      "4",
      "--memory",
      String(4 * 1024 * 1024 * 1024),
      "--scratch-bytes",
      "0",
      "--source",
      source,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  child.stdin.end(Buffer.alloc(4));
  const code = await new Promise<number | null>((accept, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Malformed-frame HCS teardown timed out."));
    }, 90_000);
    child.once("error", reject);
    child.once("close", (value) => {
      clearTimeout(timeout);
      accept(value);
    });
  });
  requireM3ProductCheck(code !== 0, "Malformed host frame did not fail the HCS helper.");
  return { helperExitCode: code, hcsTeardown: true };
}
await runCanonicalGate({
  failureClassification: "m3_windows_gate_failed",
  run: async (setFailureStage) => {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("The certified M3 Windows gate requires Windows x64 with Hyper-V.");
    }
    const root = await mkdtemp(join(tmpdir(), "vault-m3-windows-agent-"));
    try {
      const artifacts = await windowsArtifacts();
      await prepareAgentModelStore(modelRoot);
      setFailureStage("runtime_transport");
      const guest = await runGuestEvidence(
        root,
        (workspace) => new WindowsMicroVmLauncher(helper, images, workspace),
      );
      const evidence = await runWindowsEvidence(root, artifacts);
      console.log(
        JSON.stringify({
          classification: "certified_headless",
          failureClass: "passed",
          evidenceReference: null,
          guest,
          ...evidence,
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  },
});

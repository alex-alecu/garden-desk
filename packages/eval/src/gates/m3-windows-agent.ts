import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createVaultCore } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";
import { WindowsMicroVmLauncher } from "@vault/workers";
import { readCanonicalModelManifest, verifyModelFile } from "../models.js";
import { runGuestEvidence } from "./m3-guest.js";

const repositoryRoot = process.cwd();
const helper = join(
  repositoryRoot,
  "packages/workers/native/windows-hcs-helper/.generated/vault-hcs-helper.exe",
);
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");
const modelId = "gemma-4-12b-it-qat-q4_0";
const modelPath = join(modelRoot, `${modelId}.gguf`);
const packagedInference = join(
  repositoryRoot,
  "packages/desktop/src-tauri/target/release/bundle/windows/Vault Desk/resources/core/inference",
);

interface WindowsArtifacts {
  kernel: string;
  initramfs: string;
}

interface AgentEvidenceInput {
  root: string;
  name: string;
  prompt: string;
  liveToken: string;
  finishToken?: string;
  cancel?: boolean;
  expectedError?: string;
  expectLiveOutput?: boolean;
}

async function prepareModelStore(): Promise<void> {
  const manifest = await readCanonicalModelManifest();
  const model = manifest.models.find((candidate) => candidate.id === modelId);
  if (model === undefined) throw new Error(`Canonical model missing: ${modelId}`);
  await verifyModelFile(model, modelPath);
  await writeFile(
    join(modelRoot, "installed-models.json"),
    JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          modelId,
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
  return {
    kernel: join(root, String(output.kernelFile)),
    initramfs: join(root, String(output.initramfsFile)),
  };
}

async function awaitRun(
  core: Awaited<ReturnType<typeof createVaultCore>>,
  runId: string,
  liveToken: string,
  cancel: boolean,
): Promise<{ snapshot: AgentRunSnapshot; live: boolean }> {
  const deadline = performance.now() + 10 * 60_000;
  let live = false;
  let cancelled = false;
  while (performance.now() < deadline) {
    const snapshot = await core.getAgentRun(runId);
    const execution = snapshot.executions.find((item) => item.stdout.includes(liveToken));
    const runningLive = execution?.state === "running" && snapshot.run.state === "running";
    if (runningLive) {
      live = true;
    }
    if (runningLive && cancel && !cancelled) {
      cancelled = await core.cancelAgent(snapshot.run.jobId);
    }
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") {
      return { snapshot, live };
    }
    await new Promise((accept) => setTimeout(accept, 350));
  }
  throw new Error(`Windows agent run timed out: ${runId}`);
}

function requireAgentEvidence(
  result: { snapshot: AgentRunSnapshot; live: boolean },
  input: AgentEvidenceInput,
) {
  const execution = result.snapshot.executions.find((item) => item.stdout.length > 0);
  const terminalState = expectedTerminalState(result.snapshot, input.expectedError);
  const hasFinishToken =
    input.finishToken === undefined || execution?.stdout.includes(input.finishToken) === true;
  if (
    ((input.expectLiveOutput ?? true) && !result.live) ||
    execution === undefined ||
    execution.vmDiagnostics.length === 0 ||
    (input.cancel
      ? result.snapshot.run.state !== "cancelled" || execution.state !== "cancelled"
      : !terminalState || !hasFinishToken)
  ) {
    throw new Error(`Windows agent proof failed: ${JSON.stringify(result.snapshot)}`);
  }
  return execution;
}

function expectedTerminalState(
  snapshot: AgentRunSnapshot,
  expectedError: string | undefined,
): boolean {
  return expectedError === undefined
    ? snapshot.run.state === "succeeded"
    : snapshot.run.state === "failed" && snapshot.run.error === expectedError;
}

async function runAgentEvidence(input: AgentEvidenceInput) {
  const source = join(input.root, `${input.name}-source`);
  const workspace = join(input.root, `${input.name}-workspace`);
  await Promise.all([mkdir(source), mkdir(workspace)]);
  const core = await createVaultCore({
    workspaceDir: workspace,
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    workerEntryPath: join(packagedInference, "worker.mjs"),
    inferenceHelperPath: join(packagedInference, "vault-appcontainer-launcher.exe"),
    inferenceRuntimePath: join(packagedInference, "node.exe"),
  });
  try {
    const folder = await core.addFolder(source);
    const session = await core.createSession(folder.id);
    const run = await core.startAgent(session.id, input.prompt);
    const result = await awaitRun(core, run.id, input.liveToken, input.cancel ?? false);
    const execution = requireAgentEvidence(result, input);
    await core.revokeFolder(folder.id);
    const afterTeardown = await core.getAgentRun(run.id);
    const teardown = afterTeardown.executions.some((item) =>
      item.vmDiagnostics.some((diagnostic) => diagnostic.code === "teardown"),
    );
    if (!teardown) throw new Error("Windows HCS teardown diagnostic was not retained.");
    return {
      runState: result.snapshot.run.state,
      stdoutBytes: execution.stdoutBytes,
      stdoutTruncated: execution.stdoutTruncated,
      diagnostics: execution.vmDiagnostics.map((item) => item.code),
      teardown,
    };
  } finally {
    await core.close();
  }
}

async function runWindowsEvidence(root: string, artifacts: WindowsArtifacts) {
  const python = await runAgentEvidence({
    root,
    name: "python",
    prompt:
      "Execute exactly one Python source file. Print 'python-start' with flush=True, sleep for 3 seconds, then print 'python-finish' with flush=True. Do not respond before it finishes.",
    liveToken: "python-start",
    finishToken: "python-finish",
  });
  const node = await runAgentEvidence({
    root,
    name: "node",
    prompt:
      "Execute exactly one Node.js source file. Call process.stdout.write('node-start\\n'), wait 3 seconds, then call process.stdout.write('node-finish\\n'). Do not write these markers to a file. Do not respond before it finishes.",
    liveToken: "node-start",
    finishToken: "node-finish",
  });
  const cancellation = await runAgentEvidence({
    root,
    name: "cancel",
    prompt:
      "Execute exactly one Python source file. Print 'cancel-start' with flush=True, then sleep for 60 seconds.",
    liveToken: "cancel-start",
    cancel: true,
  });
  const limits = await runAgentEvidence({
    root,
    name: "limits",
    prompt:
      "Execute exactly one Python source file. Print 'limit-start' with flush=True, then print 1100000 letter x characters.",
    liveToken: "limit-start",
    finishToken: "limit-start",
    expectLiveOutput: false,
  });
  if (!limits.stdoutTruncated) throw new Error("Windows stdout truncation proof failed.");
  if (limits.runState !== "succeeded") {
    throw new Error(`Windows bounded-observation proof failed: ${limits.runState}`);
  }
  const malformedFrames = await malformedFrameEvidence(root, artifacts);
  return { python, node, cancellation, limits, malformedFrames };
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
  if (code === 0) throw new Error("Malformed host frame did not fail the HCS helper.");
  return { helperExitCode: code, hcsTeardown: true };
}

async function main(): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    throw new Error("The certified M3 Windows gate requires Windows x64 with Hyper-V.");
  }
  const root = await mkdtemp(join(tmpdir(), "vault-m3-windows-agent-"));
  try {
    const artifacts = await windowsArtifacts();
    const guest = await runGuestEvidence(
      root,
      (workspace) => new WindowsMicroVmLauncher(helper, images, workspace),
    );
    await prepareModelStore();
    const evidence = await runWindowsEvidence(root, artifacts);
    console.log(
      JSON.stringify({
        classification: "certified_headless",
        guest,
        ...evidence,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

await main();

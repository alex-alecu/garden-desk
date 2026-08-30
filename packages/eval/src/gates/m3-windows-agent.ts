import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultCore } from "@vault/core";
import { WindowsMicroVmLauncher } from "@vault/workers";
import { prepareAgentModelStore } from "./agent-model-store.js";
import { requireM3ProductCheck } from "./m3-gate-support.js";
import { runGoldenTasks } from "./m3-golden-tasks.js";
import { runGuestEvidence } from "./m3-guest.js";
import { developmentWindowsInferencePaths } from "./windows-inference.js";

const repositoryRoot = process.cwd();
const nativeRoot = join(repositoryRoot, "packages/workers/native");
const helper = join(nativeRoot, "windows-hcs-helper/.generated/vault-hcs-helper.exe");
const images = join(repositoryRoot, "packages/workers/images");
const modelRoot = join(repositoryRoot, "packages/eval/.generated/models");

interface WindowsAgentImage {
  initramfs: string;
  kernel: string;
}

async function windowsAgentImage(): Promise<WindowsAgentImage> {
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

/** Proves the HCS helper rejects a malformed host frame instead of trusting guest-controlled bytes. */
async function malformedFrameEvidence(root: string, image: WindowsAgentImage): Promise<void> {
  const source = join(root, "malformed-source");
  await mkdir(source, { recursive: true });
  const child = spawn(
    helper,
    [
      "--kernel",
      image.kernel,
      "--initramfs",
      image.initramfs,
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
}

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The M3 Windows gate requires Windows x64 with Hyper-V.");
}

const root = await mkdtemp(join(tmpdir(), "vault-m3-windows-agent-"));
try {
  const image = await windowsAgentImage();
  await prepareAgentModelStore(modelRoot);
  await runGuestEvidence(
    root,
    (workspace) => new WindowsMicroVmLauncher(helper, images, workspace),
  );
  await malformedFrameEvidence(root, image);
  const inference = await developmentWindowsInferencePaths();
  const core = await createVaultCore({
    workspaceDir: join(root, "agent-workspace"),
    modelStoreDir: modelRoot,
    profile: "auto",
    agentHelperPath: helper,
    agentImageRoot: images,
    ...inference,
  });
  try {
    await runGoldenTasks(core, root);
  } finally {
    await core.close();
  }
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

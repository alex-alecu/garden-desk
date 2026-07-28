// biome-ignore lint/style/noRestrictedImports: this is the Windows platform launcher boundary.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: this is the Windows platform staging boundary.
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobIdSchema, WorkerLimitsSchema } from "@vault/shared";
import { stagePackedAgentInputs } from "./agent-staging.js";
import { AgentHelperTransport } from "./agent-transport.js";
import { emitDiagnostic } from "./diagnostics.js";
import type { CodeAgentSession, MicroVmAgentRequest } from "./launcher.js";
import { FramedAgentSession, initializeAgentGuest } from "./macos-agent-session.js";
import { launchSignal } from "./staging.js";
import { fixedVhdFooter } from "./windows.js";
import { AgentWorkspaceStore } from "./workspace-store.js";

interface ImageManifest {
  outputs: {
    x86_64: {
      kernelFile: string;
      kernelSha256: string;
      initramfsFile: string;
      initramfsSha256: string;
    };
  };
}

const VM_BOOT_GRACE_MS = 60_000;

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function verifiedArtifacts(root: string): Promise<{ kernel: string; initramfs: string }> {
  const manifest = JSON.parse(
    await readFile(join(root, "agent", "manifest.json"), "utf8"),
  ) as ImageManifest;
  const output = manifest.outputs.x86_64;
  if (output === undefined) throw new Error("Windows agent image is not configured.");
  const artifacts = join(root, ".generated", "agent", "artifacts", "x86_64");
  const kernel = join(artifacts, output.kernelFile);
  const initramfs = join(artifacts, output.initramfsFile);
  if ((await digest(kernel)) !== output.kernelSha256)
    throw new Error("Agent kernel hash mismatch.");
  if ((await digest(initramfs)) !== output.initramfsSha256) {
    throw new Error("Agent initramfs hash mismatch.");
  }
  return { kernel, initramfs };
}

async function addVhdFooter(path: string): Promise<void> {
  const capacity = (await stat(path)).size;
  const handle = await open(path, "r+");
  try {
    await handle.truncate(capacity + 512);
    await handle.write(fixedVhdFooter(capacity), 0, 512, capacity);
  } finally {
    await handle.close();
  }
}

function helperArguments(input: {
  artifacts: { kernel: string; initramfs: string };
  inputs: string[];
  request: MicroVmAgentRequest;
}): string[] {
  const args = [
    "--kernel",
    input.artifacts.kernel,
    "--initramfs",
    input.artifacts.initramfs,
    "--cpus",
    String(input.request.limits.cpuCount),
    "--memory",
    String(input.request.limits.memoryBytes),
    "--scratch-bytes",
    "0",
    "--source",
    input.request.sourceFolder,
  ];
  for (const path of input.inputs) args.push("--input", path);
  return args;
}

export class WindowsAgentLauncher {
  private workspaceStore?: Promise<AgentWorkspaceStore>;

  constructor(
    private readonly helperPath: string,
    private readonly imageRoot: string = join(process.cwd(), "packages/workers/images"),
    private readonly workspaceRoot: string = join(process.cwd(), ".vault/agent-workspaces"),
  ) {}

  private store(): Promise<AgentWorkspaceStore> {
    this.workspaceStore ??= AgentWorkspaceStore.create(this.workspaceRoot);
    return this.workspaceStore;
  }

  private async startAgentSession(
    request: MicroVmAgentRequest,
    temporaryRoot: string,
    signal: AbortSignal,
  ): Promise<CodeAgentSession> {
    await emitDiagnostic(request.observer, "windows", "staging");
    const inputs = await stagePackedAgentInputs(
      request.readonlyInputs,
      temporaryRoot,
      request.limits,
      signal,
    );
    await Promise.all(inputs.devices.map(addVhdFooter));
    const artifacts = await verifiedArtifacts(this.imageRoot);
    await emitDiagnostic(request.observer, "windows", "vm_start");
    const transport = new AgentHelperTransport(
      spawn(this.helperPath, helperArguments({ artifacts, inputs: inputs.devices, request }), {
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    try {
      await transport.ready(signal);
      const limits = { ...request.limits };
      const store = await this.store();
      await initializeAgentGuest({
        sessionId: request.sessionId,
        inputs: inputs.entries,
        limits,
        transport,
        store,
        signal,
      });
      await emitDiagnostic(request.observer, "windows", "guest_connection");
      return new FramedAgentSession({
        sessionId: request.sessionId,
        limits,
        transport,
        store,
        temporaryRoot,
        lifecyclePlatform: "windows",
        ...(request.observer === undefined ? {} : { lifecycleObserver: request.observer }),
      });
    } catch (error) {
      await emitDiagnostic(request.observer, "windows", "platform_error", error);
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async openAgentSession(request: MicroVmAgentRequest): Promise<CodeAgentSession> {
    if (process.platform !== "win32" || process.arch !== "x64") {
      throw new Error("The certified Windows agent backend requires Windows x64 with Hyper-V.");
    }
    JobIdSchema.parse(request.sessionId);
    WorkerLimitsSchema.parse(request.limits);
    const signal = launchSignal(request.signal, VM_BOOT_GRACE_MS + request.limits.wallTimeMs);
    const temporaryRoot = await mkdtemp(join(tmpdir(), `vault-agent-${request.sessionId}-`));
    try {
      return await this.startAgentSession(request, temporaryRoot, signal);
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      throw error;
    }
  }

  async deleteWorkspace(sessionId: string): Promise<void> {
    await (await this.store()).delete(sessionId);
  }
}

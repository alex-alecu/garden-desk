import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  JobIdSchema,
  MicroVmProbeReportSchema,
  type WorkerLimits,
  WorkerLimitsSchema,
} from "@gardendesk/shared";
import { stagePackedAgentInputs } from "./agent-staging.js";
import { AgentHelperTransport } from "./agent-transport.js";
import { emitDiagnostic } from "./diagnostics.js";
import type {
  CodeAgentLauncher,
  CodeAgentSession,
  MicroVmAgentRequest,
  MicroVmLauncher,
  MicroVmLaunchRequest,
  MicroVmLaunchResult,
} from "./launcher.js";
import { FramedAgentSession, initializeAgentGuest } from "./macos-agent-session.js";
import { copyBoundedInput, launchSignal } from "./staging.js";
import { AgentWorkspaceStore } from "./workspace-store.js";

interface ImageManifest {
  outputs: {
    aarch64: {
      kernelFile: string;
      kernelSha256: string;
      initramfsFile: string;
      initramfsSha256: string;
    };
  };
}

interface LaunchBounds {
  limits: WorkerLimits;
}

type AgentLimits = Pick<
  WorkerLimits,
  "wallTimeMs" | "memoryBytes" | "scratchBytes" | "outputBytes"
>;

const VM_BOOT_GRACE_MS = 15_000;
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024 * 1024;

async function verifiedArtifacts(root: string): Promise<{ kernel: string; initramfs: string }> {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as ImageManifest;
  const output = manifest.outputs.aarch64;
  const artifacts = join(root, ".generated", "artifacts", "aarch64");
  const kernel = join(artifacts, output.kernelFile);
  const initramfs = join(artifacts, output.initramfsFile);
  if ((await digest(kernel)) !== output.kernelSha256)
    throw new Error("Guest kernel hash mismatch.");
  if ((await digest(initramfs)) !== output.initramfsSha256)
    throw new Error("Guest initramfs hash mismatch.");
  return { kernel, initramfs };
}

async function verifiedAgentArtifacts(
  root: string,
): Promise<{ kernel: string; initramfs: string }> {
  const manifest = JSON.parse(
    await readFile(join(root, "agent", "manifest.json"), "utf8"),
  ) as ImageManifest;
  const output = manifest.outputs.aarch64;
  const artifacts = join(root, ".generated", "agent", "artifacts", "aarch64");
  const kernel = join(artifacts, output.kernelFile);
  const initramfs = join(artifacts, output.initramfsFile);
  if ((await digest(kernel)) !== output.kernelSha256)
    throw new Error("Agent kernel hash mismatch.");
  if ((await digest(initramfs)) !== output.initramfsSha256) {
    throw new Error("Agent initramfs hash mismatch.");
  }
  return { kernel, initramfs };
}

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function stageInputs(
  paths: string[],
  root: string,
  request: LaunchBounds,
  signal: AbortSignal,
): Promise<string[]> {
  if (paths.length > request.limits.inputCount) throw new Error("worker_input_limit_exceeded");
  const staged: string[] = [];
  let remaining = request.limits.inputBytes;
  for (const [index, source] of paths.entries()) {
    signal.throwIfAborted();
    const destination = join(root, `input-${index}-${basename(source)}.img`);
    const sourceBytes = (await stat(source)).size;
    const stagedBytes = Math.max(4096, Math.ceil(sourceBytes / 4096) * 4096);
    if (stagedBytes > remaining) throw new Error("worker_input_limit_exceeded");
    await copyBoundedInput(source, destination, stagedBytes, signal);
    await truncate(destination, stagedBytes);
    remaining -= stagedBytes;
    staged.push(destination);
  }
  return staged;
}

function helperArguments(input: {
  artifacts: { kernel: string; initramfs: string };
  inputs: string[];
  request: LaunchBounds;
  scratch?: string;
  source?: string;
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
  ];
  if (input.scratch !== undefined) args.push("--scratch", input.scratch);
  for (const path of input.inputs) args.push("--input", path);
  if (input.source !== undefined) args.push("--source", input.source);
  return args;
}

function runHelper(helper: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(helper, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (Buffer.byteLength(output) > MAX_HELPER_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk);
      if (Buffer.byteLength(errorOutput) > MAX_HELPER_OUTPUT_BYTES) child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) accept(output);
      else reject(new Error(errorOutput.trim() || `macOS helper exited with ${code}.`));
    });
  });
}

function agentLimits(limits: WorkerLimits): AgentLimits {
  return {
    wallTimeMs: limits.wallTimeMs,
    memoryBytes: limits.memoryBytes,
    scratchBytes: limits.scratchBytes,
    outputBytes: limits.outputBytes,
  };
}

export class MacOsMicroVmLauncher implements MicroVmLauncher, CodeAgentLauncher {
  private workspaceStore?: Promise<AgentWorkspaceStore>;

  constructor(
    private readonly helperPath: string,
    private readonly imageRoot: string = join(process.cwd(), "packages/workers/images"),
    private readonly workspaceRoot: string = join(process.cwd(), ".garden-desk/agent-workspaces"),
  ) {}

  private store(): Promise<AgentWorkspaceStore> {
    this.workspaceStore ??= AgentWorkspaceStore.create(this.workspaceRoot);
    return this.workspaceStore;
  }

  async launchProbe(request: MicroVmLaunchRequest): Promise<MicroVmLaunchResult> {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error("The certified macOS backend requires Apple silicon.");
    }
    JobIdSchema.parse(request.jobId);
    WorkerLimitsSchema.parse(request.limits);
    const signal = launchSignal(request.signal, request.limits.wallTimeMs + VM_BOOT_GRACE_MS);
    signal.throwIfAborted();
    const temporaryRoot = await mkdtemp(join(tmpdir(), `garden-desk-worker-${request.jobId}-`));
    try {
      const inputs = await stageInputs(request.readonlyInputs, temporaryRoot, request, signal);
      const scratch = join(temporaryRoot, "scratch.img");
      const scratchHandle = await open(scratch, "wx", 0o600);
      await scratchHandle.close();
      await truncate(scratch, request.limits.scratchBytes);
      signal.throwIfAborted();
      const artifacts = await verifiedArtifacts(this.imageRoot);
      signal.throwIfAborted();
      const args = helperArguments({
        artifacts,
        inputs,
        request,
        scratch,
      });
      const result = MicroVmProbeReportSchema.parse(
        JSON.parse(await runHelper(this.helperPath, args, signal)),
      );
      const certified =
        result.networkDeviceCount === 0 &&
        result.socketDeviceCount === 1 &&
        result.readOnlyInputCount === request.readonlyInputs.length &&
        result.scratchBytes === request.limits.scratchBytes &&
        result.guest.nonLoopbackNetworkDeviceCount === 0;
      if (!certified) {
        return { ...result, classification: "compatible_unverified" };
      }
      return result;
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async openAgentSession(request: MicroVmAgentRequest): Promise<CodeAgentSession> {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error("The certified macOS backend requires Apple silicon.");
    }
    JobIdSchema.parse(request.sessionId);
    WorkerLimitsSchema.parse(request.limits);
    const signal = launchSignal(request.signal, VM_BOOT_GRACE_MS + request.limits.wallTimeMs);
    signal.throwIfAborted();
    const temporaryRoot = await mkdtemp(join(tmpdir(), `garden-desk-agent-${request.sessionId}-`));
    try {
      return await this.startAgentSession(request, temporaryRoot, signal);
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  private async startAgentSession(
    request: MicroVmAgentRequest,
    temporaryRoot: string,
    signal: AbortSignal,
  ): Promise<CodeAgentSession> {
    await emitDiagnostic(request.observer, "macos", "staging");
    const inputs = await stagePackedAgentInputs(
      request.readonlyInputs,
      temporaryRoot,
      request.limits,
      signal,
    );
    const artifacts = await verifiedAgentArtifacts(this.imageRoot);
    const args = helperArguments({
      artifacts,
      inputs: inputs.devices,
      request,
      source: request.sourceFolder,
    });
    await emitDiagnostic(request.observer, "macos", "vm_start");
    const transport = new AgentHelperTransport(
      spawn(this.helperPath, args, { stdio: ["pipe", "pipe", "pipe"] }),
    );
    try {
      await transport.ready(signal);
      const limits = agentLimits(request.limits);
      const store = await this.store();
      await initializeAgentGuest({
        sessionId: request.sessionId,
        inputs: inputs.entries,
        limits,
        transport,
        store,
        signal,
      });
      await emitDiagnostic(request.observer, "macos", "guest_connection");
      return new FramedAgentSession({
        sessionId: request.sessionId,
        limits,
        transport,
        store,
        temporaryRoot,
        lifecyclePlatform: "macos",
        ...(request.observer === undefined ? {} : { lifecycleObserver: request.observer }),
      });
    } catch (error) {
      await emitDiagnostic(request.observer, "macos", "platform_error", error);
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async deleteWorkspace(sessionId: string): Promise<void> {
    await (await this.store()).delete(sessionId);
  }

  async readWorkspaceFile(sessionId: string, path: string): Promise<Buffer | undefined> {
    return await (await this.store()).readFile(sessionId, path);
  }
}

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { JobIdSchema, MicroVmProbeReportSchema, WorkerLimitsSchema } from "@gardendesk/shared";
import type {
  CodeAgentLauncher,
  CodeAgentSession,
  MicroVmAgentRequest,
  MicroVmLauncher,
  MicroVmLaunchRequest,
  MicroVmLaunchResult,
} from "./launcher.js";
import { copyBoundedInput, launchSignal } from "./staging.js";
import { WindowsAgentLauncher } from "./windows-agent.js";

const SECTOR_BYTES = 512;
const MINIMUM_INPUT_BYTES = 4 * 1024 * 1024;

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

async function digest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function verifiedArtifacts(): Promise<{ kernel: string; initramfs: string }> {
  const root = join(process.cwd(), "packages/workers/images");
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as ImageManifest;
  const output = manifest.outputs.x86_64;
  const artifacts = join(root, ".generated", "artifacts", "x86_64");
  const kernel = join(artifacts, output.kernelFile);
  const initramfs = join(artifacts, output.initramfsFile);
  if ((await digest(kernel)) !== output.kernelSha256)
    throw new Error("Guest kernel hash mismatch.");
  if ((await digest(initramfs)) !== output.initramfsSha256)
    throw new Error("Guest initramfs hash mismatch.");
  return { kernel, initramfs };
}

function diskGeometry(bytes: number): number {
  let sectors = Math.min(Math.floor(bytes / SECTOR_BYTES), 65535 * 16 * 255);
  let sectorsPerTrack = 17;
  let cylinders = Math.floor(sectors / sectorsPerTrack);
  let heads = Math.ceil(cylinders / 1024);
  if (heads < 4) heads = 4;
  if (cylinders >= heads * 1024 || heads > 16) {
    sectorsPerTrack = 31;
    heads = 16;
    cylinders = Math.floor(sectors / (heads * sectorsPerTrack));
  }
  if (cylinders >= heads * 1024) {
    sectorsPerTrack = 63;
    heads = 16;
    cylinders = Math.floor(sectors / (heads * sectorsPerTrack));
  }
  sectors = Math.min(cylinders, 65535);
  return ((sectors << 16) | (heads << 8) | sectorsPerTrack) >>> 0;
}

export function fixedVhdFooter(capacity: number): Buffer {
  const footer = Buffer.alloc(SECTOR_BYTES);
  footer.write("conectix", 0, "ascii");
  footer.writeUInt32BE(2, 8);
  footer.writeUInt32BE(0x0001_0000, 12);
  footer.writeBigUInt64BE(0xffff_ffff_ffff_ffffn, 16);
  footer.write("vltD", 28, "ascii");
  footer.writeUInt32BE(0x0001_0000, 32);
  footer.write("Wi2k", 36, "ascii");
  footer.writeBigUInt64BE(BigInt(capacity), 40);
  footer.writeBigUInt64BE(BigInt(capacity), 48);
  footer.writeUInt32BE(diskGeometry(capacity), 56);
  footer.writeUInt32BE(2, 60);
  randomBytes(16).copy(footer, 68);
  const checksum = footer.reduce((sum, value) => (sum + value) >>> 0, 0);
  footer.writeUInt32BE(~checksum >>> 0, 64);
  return footer;
}

async function createFixedVhd(path: string, capacity: number): Promise<void> {
  const handle = await open(path, "wx+");
  try {
    await handle.truncate(capacity + SECTOR_BYTES);
    await handle.write(fixedVhdFooter(capacity), 0, SECTOR_BYTES, capacity);
  } finally {
    await handle.close();
  }
}

async function stageInputs(
  paths: string[],
  root: string,
  request: MicroVmLaunchRequest,
  signal: AbortSignal,
): Promise<string[]> {
  if (paths.length > request.limits.inputCount) throw new Error("worker_input_limit_exceeded");
  const staged: string[] = [];
  let remaining = request.limits.inputBytes;
  for (const [index, source] of paths.entries()) {
    signal.throwIfAborted();
    const destination = join(root, `input-${index}-${basename(source)}.vhd`);
    const size = (await stat(source)).size;
    const capacity = Math.max(MINIMUM_INPUT_BYTES, Math.ceil(size / SECTOR_BYTES) * SECTOR_BYTES);
    const stagedBytes = capacity + SECTOR_BYTES;
    if (stagedBytes > remaining) throw new Error("worker_input_limit_exceeded");
    await copyBoundedInput(source, destination, capacity, signal);
    const handle = await open(destination, "r+");
    try {
      await handle.truncate(stagedBytes);
      await handle.write(fixedVhdFooter(capacity), 0, SECTOR_BYTES, capacity);
    } finally {
      await handle.close();
    }
    remaining -= stagedBytes;
    staged.push(destination);
  }
  return staged;
}

function helperArguments(input: {
  artifacts: { kernel: string; initramfs: string };
  inputs: string[];
  request: MicroVmLaunchRequest;
  scratch: string | undefined;
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
    String(input.request.limits.scratchBytes),
  ];
  if (input.scratch !== undefined) args.push("--scratch", input.scratch);
  for (const path of input.inputs) args.push("--input", path);
  return args;
}

function runHelper(
  helper: string,
  args: string[],
  request: MicroVmLaunchRequest,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(helper, args, {
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (Buffer.byteLength(output) > request.limits.outputBytes) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += String(chunk);
      if (Buffer.byteLength(errorOutput) > request.limits.outputBytes) child.kill();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) accept(output);
      else reject(new Error(errorOutput.trim() || `Windows helper exited with ${code}.`));
    });
  });
}

export class WindowsMicroVmLauncher implements MicroVmLauncher, CodeAgentLauncher {
  private readonly agent: WindowsAgentLauncher;

  constructor(
    private readonly helperPath: string,
    imageRoot?: string,
    workspaceRoot?: string,
  ) {
    this.agent = new WindowsAgentLauncher(helperPath, imageRoot, workspaceRoot);
  }

  openAgentSession(request: MicroVmAgentRequest): Promise<CodeAgentSession> {
    return this.agent.openAgentSession(request);
  }

  deleteWorkspace(sessionId: string): Promise<void> {
    return this.agent.deleteWorkspace(sessionId);
  }

  readWorkspaceFile(sessionId: string, path: string): Promise<Buffer | undefined> {
    return this.agent.readWorkspaceFile(sessionId, path);
  }

  async launchProbe(request: MicroVmLaunchRequest): Promise<MicroVmLaunchResult> {
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new Error("The certified Windows backend requires Windows x64 with Hyper-V.");
    JobIdSchema.parse(request.jobId);
    WorkerLimitsSchema.parse(request.limits);
    if (request.limits.scratchBytes % SECTOR_BYTES !== 0)
      throw new Error("Windows scratch size must be aligned to 512 bytes.");
    const signal = launchSignal(request.signal, request.limits.wallTimeMs);
    signal.throwIfAborted();
    const temporaryRoot = await mkdtemp(join(tmpdir(), `garden-desk-worker-${request.jobId}-`));
    try {
      const inputs = await stageInputs(request.readonlyInputs, temporaryRoot, request, signal);
      const scratch =
        request.limits.scratchBytes === 0 ? undefined : join(temporaryRoot, "scratch.vhd");
      if (scratch !== undefined) await createFixedVhd(scratch, request.limits.scratchBytes);
      signal.throwIfAborted();
      const artifacts = await verifiedArtifacts();
      signal.throwIfAborted();
      const result = MicroVmProbeReportSchema.parse(
        JSON.parse(
          await runHelper(
            this.helperPath,
            helperArguments({ artifacts, inputs, request, scratch }),
            request,
            signal,
          ),
        ),
      );
      const certified =
        result.networkDeviceCount === 0 &&
        result.socketDeviceCount === 1 &&
        result.readOnlyInputCount === request.readonlyInputs.length &&
        result.scratchBytes === request.limits.scratchBytes &&
        result.guest.nonLoopbackNetworkDeviceCount === 0;
      return certified ? result : { ...result, classification: "compatible_unverified" };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    }
  }
}

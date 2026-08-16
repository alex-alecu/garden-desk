// biome-ignore lint/style/noRestrictedImports: this module is the bounded image process launcher.
import { spawn } from "node:child_process";
// biome-ignore lint/style/noRestrictedImports: this launcher owns its private prompt scratch.
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface VisionExecution {
  imagePath: string;
  memoryBudgetBytes: number;
  modelPath: string;
  projectorPath: string;
  prompt: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

const MAX_STDOUT = 256 * 1024;
const MAX_STDERR = 64 * 1024;
const preparations = new Map<string, Promise<void>>();
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

function literal(path: string): string {
  return JSON.stringify(resolve(path));
}

function parentPaths(path: string): string[] {
  const parents: string[] = [];
  let current = resolve(path);
  while (current !== dirname(current)) {
    current = dirname(current);
    parents.push(current);
  }
  return parents;
}

export function visionSandboxProfile(
  input: VisionExecution,
  runtime: string,
  scratch: string,
): string {
  const runtimeRoot = dirname(runtime);
  const exact = [input.modelPath, input.projectorPath, input.imagePath];
  const exceptions = [
    '(literal "/")',
    ...parentPaths(scratch).map((path) => `(literal ${literal(path)})`),
    '(subpath "/System")',
    '(subpath "/usr/lib")',
    '(literal "/dev/null")',
    '(literal "/dev/urandom")',
    `(subpath ${literal(runtimeRoot)})`,
    `(subpath ${literal(scratch)})`,
    ...exact.map((path) => `(literal ${literal(path)})`),
  ];
  const outside = exceptions.map((rule) => `(require-not ${rule})`).join(" ");
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(deny mach-lookup (global-name "com.apple.securityd"))',
    `(deny file-read-data (require-all (subpath "/") ${outside}))`,
    `(deny file-write* (require-not (subpath ${literal(scratch)})))`,
    "(deny process-fork)",
    "(deny process-exec)",
    `(allow process-exec (literal ${literal(runtime)}))`,
  ].join("\n");
}

export function visionRuntimeArguments(input: VisionExecution, promptFile: string): string[] {
  return [
    "--offline",
    "--no-warmup",
    "--log-verbosity",
    "1",
    "--jinja",
    "--model",
    resolve(input.modelPath),
    "--mmproj",
    resolve(input.projectorPath),
    "--image",
    resolve(input.imagePath),
    "--file",
    resolve(promptFile),
    "--predict",
    "2048",
    "--ctx-size",
    "8192",
    "--temperature",
    "0",
  ];
}

export interface WindowsVisionLaunch {
  input: VisionExecution;
  promptFile: string;
  runtime: string;
  scratch: string;
  vulkanDeviceIndex?: number;
}

export function windowsVisionArguments(launch: WindowsVisionLaunch): string[] {
  const { input, runtime, promptFile, scratch, vulkanDeviceIndex } = launch;
  if (
    vulkanDeviceIndex !== undefined &&
    (!Number.isSafeInteger(vulkanDeviceIndex) ||
      vulkanDeviceIndex < 0 ||
      vulkanDeviceIndex > 0xffff_ffff)
  ) {
    throw new Error("invalid_windows_gpu_selection");
  }
  const arguments_ = [
    "run-vision",
    "--executable",
    resolve(runtime),
    "--model",
    resolve(input.modelPath),
    "--projector",
    resolve(input.projectorPath),
    "--image",
    resolve(input.imagePath),
    "--prompt-file",
    resolve(promptFile),
    "--scratch",
    resolve(scratch),
    "--memory",
    String(input.memoryBudgetBytes),
  ];
  if (vulkanDeviceIndex !== undefined) {
    arguments_.push("--vulkan-device-index", String(vulkanDeviceIndex));
  }
  return arguments_;
}

export function parseVisionOutput(output: string): string {
  const clean = output.replace(ANSI_COLOR, "");
  const marker = /(?:<\|channel\|>|<channel\|>)\s*final(?:<\|message\|>|<message\|>)?/giu;
  let finalStart = -1;
  for (const match of clean.matchAll(marker)) finalStart = (match.index ?? 0) + match[0].length;
  if (finalStart < 0) {
    const compactMarker = clean.lastIndexOf("<channel|>");
    if (compactMarker >= 0) finalStart = compactMarker + "<channel|>".length;
  }
  if (finalStart < 0) throw new Error("vision_final_response_missing");
  const text = clean
    .slice(finalStart)
    .replace(/<\|(?:end|eot_id|turn|return)\|>|<(?:end|turn|return)\|>/giu, "")
    .trim();
  if (text.length === 0) throw new Error("vision_empty_response");
  return text;
}

function helperEnvironment(scratch: string): NodeJS.ProcessEnv {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  return process.platform === "win32"
    ? { PATH: join(windowsRoot, "System32"), SystemRoot: windowsRoot, WINDIR: windowsRoot }
    : {
        HOME: scratch,
        TMPDIR: scratch,
        PATH: "/usr/bin:/bin",
        LLAMA_ARG_OFFLINE: "1",
      };
}

async function prepareWindows(helper: string, runtime: string, signal: AbortSignal): Promise<void> {
  const root = dirname(resolve(runtime));
  const key = `${helper}\0${root}`;
  const existing = preparations.get(key);
  if (existing !== undefined) return await existing;
  const pending = collectProcess({
    command: helper,
    args: ["prepare", "--read", root],
    cwd: root,
    env: helperEnvironment(root),
    signal,
  }).then(() => undefined);
  preparations.set(key, pending);
  try {
    await pending;
  } catch (error) {
    preparations.delete(key);
    throw error;
  }
}

function collectProcess(input: {
  args: string[];
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let abort: () => void;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      input.signal?.removeEventListener("abort", abort);
      child.kill("SIGKILL");
      reject(error);
    };
    abort = () => fail(input.signal?.reason ?? new DOMException("Cancelled.", "AbortError"));
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted === true) abort();
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout) > MAX_STDOUT) fail(new Error("vision_output_limit"));
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.byteLength(stderr) < MAX_STDERR) stderr += String(chunk);
    });
    child.once("error", fail);
    child.once("close", (code) => {
      input.signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      if (code === 0) accept(stdout);
      else
        reject(
          new Error(stderr.trim().slice(0, MAX_STDERR) || `Vision runtime exited with ${code}.`),
        );
    });
  });
}

function defaultWindowsHelper(): string {
  return join(
    process.cwd(),
    "packages/workers/native/windows-appcontainer-launcher/.generated/vault-appcontainer-launcher.exe",
  );
}

export class LlamaVisionClient {
  constructor(
    private readonly runtimePath: string,
    private readonly windowsHelperPath = defaultWindowsHelper(),
    private readonly windowsVulkanDeviceIndex?: number,
  ) {}

  async inspect(input: VisionExecution): Promise<{ text: string }> {
    const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
    const operationSignal =
      input.signal === undefined ? timeoutSignal : AbortSignal.any([input.signal, timeoutSignal]);
    operationSignal.throwIfAborted();
    const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "vault-vision-")));
    const promptFile = join(temporaryRoot, "prompt.txt");
    try {
      await writeFile(promptFile, input.prompt, { encoding: "utf8", flag: "wx", mode: 0o600 });
      const runtime = await realpath(this.runtimePath);
      let command: string;
      let args: string[];
      if (process.platform === "win32") {
        await prepareWindows(this.windowsHelperPath, runtime, operationSignal);
        operationSignal.throwIfAborted();
        command = this.windowsHelperPath;
        args = windowsVisionArguments({
          input,
          runtime,
          promptFile,
          scratch: temporaryRoot,
          ...(this.windowsVulkanDeviceIndex === undefined
            ? {}
            : { vulkanDeviceIndex: this.windowsVulkanDeviceIndex }),
        });
      } else if (process.platform === "darwin" && process.arch === "arm64") {
        command = "/usr/bin/sandbox-exec";
        args = [
          "-p",
          visionSandboxProfile(input, runtime, temporaryRoot),
          runtime,
          ...visionRuntimeArguments(input, promptFile),
        ];
      } else {
        throw new Error("unsupported_vision_platform");
      }
      const stdout = await collectProcess({
        command,
        args,
        cwd: temporaryRoot,
        env: helperEnvironment(temporaryRoot),
        signal: operationSignal,
      });
      return { text: parseVisionOutput(stdout) };
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

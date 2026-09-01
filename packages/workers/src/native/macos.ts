import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  NativeWorkerHandle,
  NativeWorkerLauncher,
  NativeWorkerLaunchRequest,
} from "./launcher.js";
import { NativeWorkerLaunchError } from "./launcher.js";

function literal(path: string): string {
  return JSON.stringify(resolve(path));
}

function credentialPaths(): string[] {
  return [
    ".aws",
    ".azure",
    ".config/gcloud",
    ".config/gh",
    ".docker",
    ".kube",
    ".netrc",
    ".npmrc",
    ".ssh",
    "Library/Keychains",
  ].map((path) => join(homedir(), path));
}

function runtimeReadPaths(workerEntryPath: string): string[] {
  const workerDirectory = dirname(workerEntryPath);
  const packagedModules = join(workerDirectory, "node_modules");
  if (existsSync(packagedModules)) return [workerDirectory, packagedModules];
  return [
    resolve(workerDirectory, "../.."),
    resolve(workerDirectory, "../../..", "shared"),
    resolve(workerDirectory, "../../../..", "node_modules"),
  ];
}

const SYSTEM_READ_PATHS = ["/System", "/usr/lib"];

function parentPaths(path: string): string[] {
  const parents: string[] = [];
  let current = resolve(path);
  while (current !== dirname(current)) {
    current = dirname(current);
    parents.push(current);
  }
  return parents;
}

function hostDataDeny(
  readPaths: string[],
  temporaryRoot: string,
  runtimeExecutable: string,
  modelPath?: string,
): string {
  const exceptions = [
    '(literal "/")',
    ...parentPaths(temporaryRoot).map((path) => `(literal ${literal(path)})`),
    ...SYSTEM_READ_PATHS.map((path) => `(subpath ${literal(path)})`),
    ...readPaths.map((path) => `(subpath ${literal(path)})`),
    `(literal ${literal(runtimeExecutable)})`,
    `(literal ${literal(temporaryRoot)})`,
    `(subpath ${literal(temporaryRoot)})`,
    ...(modelPath === undefined ? [] : [`(literal ${literal(modelPath)})`]),
  ];
  const outsideExceptions = exceptions.map((rule) => `(require-not ${rule})`).join(" ");
  return `(deny file-read-data (require-all (subpath "/") ${outsideExceptions}))`;
}

function sandboxProfile(
  request: NativeWorkerLaunchRequest,
  temporaryRoot: string,
  deniedPaths: string[],
  runtimeExecutable: string,
): string {
  const runtimeExecutables = [runtimeExecutable];
  const protectedRules = [...deniedPaths, ...credentialPaths()]
    .map((path) => `(subpath ${literal(path)})`)
    .join(" ");
  const readPaths = runtimeReadPaths(request.workerEntryPath);
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(deny mach-lookup (global-name "com.apple.securityd"))',
    hostDataDeny(readPaths, temporaryRoot, runtimeExecutable, request.modelPath),
    `(deny file-write* (require-not (subpath ${literal(temporaryRoot)})))`,
    "(deny process-fork)",
    "(deny process-exec)",
    `(allow process-exec ${runtimeExecutables.map((path) => `(literal ${literal(path)})`).join(" ")})`,
    `(allow file-read* (literal ${literal(runtimeExecutable)}))`,
    ...SYSTEM_READ_PATHS.map((path) => `(allow file-read* (subpath ${literal(path)}))`),
    ...readPaths.map((path) => `(allow file-read* (subpath ${literal(path)}))`),
    ...(request.modelPath === undefined
      ? []
      : [`(allow file-read* (literal ${literal(request.modelPath)}))`]),
    `(allow file-read* (subpath ${literal(temporaryRoot)}))`,
    `(allow file-write* (subpath ${literal(temporaryRoot)}))`,
    ...(protectedRules === "" ? [] : [`(deny file-read* ${protectedRules})`]),
  ].join("\n");
}

export class MacOsNativeWorkerLauncher implements NativeWorkerLauncher {
  constructor(
    private readonly deniedPaths: string[] = [],
    private readonly runtimeExecutable: string = process.execPath,
  ) {}

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: sandbox construction and process cleanup remain paired.
  async launch(request: NativeWorkerLaunchRequest): Promise<NativeWorkerHandle> {
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new NativeWorkerLaunchError("unsupported", "unsupported_native_worker_platform");
    }
    const temporaryAlias = await mkdtemp(join(tmpdir(), "garden-desk-inference-"));
    const temporaryRoot = await realpath(temporaryAlias);
    const profile = sandboxProfile(
      request,
      temporaryRoot,
      this.deniedPaths,
      this.runtimeExecutable,
    );
    const args = [
      "-p",
      profile,
      this.runtimeExecutable,
      "--conditions=gardendesk-runtime",
      request.workerEntryPath,
      "--memory-budget",
      String(request.memoryBudgetBytes),
    ];
    if (request.modelPath !== undefined) args.push("--model", request.modelPath);
    const child = spawn("/usr/bin/sandbox-exec", args, {
      cwd: temporaryRoot,
      env: {
        HOME: temporaryRoot,
        TMPDIR: temporaryRoot,
        PATH: "/usr/bin:/bin",
        NODE_NO_WARNINGS: "1",
        NODE_LLAMA_CPP_GPU: "metal",
        NODE_LLAMA_CPP_SKIP_DOWNLOAD: "true",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let disposed = false;
    return {
      process: child,
      async dispose() {
        if (disposed) return;
        disposed = true;
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await new Promise<void>((accept) => {
          if (child.exitCode !== null || child.signalCode !== null) accept();
          else child.once("close", () => accept());
        });
        await rm(temporaryRoot, { recursive: true, force: true });
      },
    };
  }
}

#!/usr/bin/env node
import { rename, unlink, writeFile } from "node:fs/promises";
import { createVaultCore } from "../compose.js";
import { runDebugSessionMode } from "../diagnostics/process.js";
import { initializeEmptyModelStore } from "../runtime/models.js";
import { monitorParent, openWithWorkspaceRetry } from "./lifecycle.js";
import { startDaemon } from "./server.js";

function argument(args: string[], name: string, required = true): string | undefined {
  const index = args.indexOf(name);
  const value = index === -1 ? undefined : args[index + 1];
  if (required && value === undefined) {
    throw new Error(
      "Usage: vault-cored --workspace <directory> --model-store <directory> --profile <auto|local12|local16>",
    );
  }
  return value;
}

function parentPidArgument(args: string[]): number | undefined {
  const value = argument(args, "--parent-pid", false);
  if (value === undefined) return undefined;
  const parentPid = Number(value);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) throw new Error("Invalid parent PID.");
  return parentPid;
}

interface LaunchOptions {
  agentHelperPath: string | undefined;
  agentImageRoot: string | undefined;
  inferenceRuntimePath: string | undefined;
  migrationDirectory: string | undefined;
  modelStoreDir: string;
  packagedModelStore: boolean;
  parentPid: number | undefined;
  profile: "auto" | "local12" | "local16";
  readyFile: string | undefined;
  sessionsOnly: boolean;
  windowsPipeGuardPath: string | undefined;
  workerEntryPath: string | undefined;
  workspaceDir: string;
}

function launchOptions(args: string[]): LaunchOptions {
  const workspaceDir = argument(args, "--workspace");
  const modelStoreDir = argument(args, "--model-store");
  const profile = argument(args, "--profile");
  if (workspaceDir === undefined || modelStoreDir === undefined) throw new Error("Missing paths.");
  if (profile !== "auto" && profile !== "local12" && profile !== "local16") {
    throw new Error("Invalid profile.");
  }
  return {
    agentHelperPath: argument(args, "--agent-helper", false),
    agentImageRoot: argument(args, "--agent-image-root", false),
    inferenceRuntimePath: argument(args, "--inference-runtime", false),
    migrationDirectory: argument(args, "--migration-directory", false),
    modelStoreDir,
    packagedModelStore: args.includes("--packaged-model-store"),
    parentPid: parentPidArgument(args),
    profile,
    readyFile: argument(args, "--ready-file", false),
    sessionsOnly: args.includes("--sessions-only"),
    windowsPipeGuardPath: argument(args, "--windows-pipe-guard", false),
    workerEntryPath: argument(args, "--worker-entry", false),
    workspaceDir,
  };
}

function openCore(options: LaunchOptions) {
  return openWithWorkspaceRetry(
    () =>
      createVaultCore({
        workspaceDir: options.workspaceDir,
        modelStoreDir: options.modelStoreDir,
        profile: options.profile,
        ...(options.migrationDirectory === undefined
          ? {}
          : { migrationDirectory: options.migrationDirectory }),
        sessionsOnly: options.sessionsOnly,
        ...(options.workerEntryPath === undefined
          ? {}
          : { workerEntryPath: options.workerEntryPath }),
        ...(options.inferenceRuntimePath === undefined
          ? {}
          : { inferenceRuntimePath: options.inferenceRuntimePath }),
        ...(options.agentHelperPath === undefined
          ? {}
          : { agentHelperPath: options.agentHelperPath }),
        ...(options.agentImageRoot === undefined ? {} : { agentImageRoot: options.agentImageRoot }),
      }),
    options.parentPid === undefined ? 0 : 2_000,
  );
}

async function startServer(args: string[]): Promise<void> {
  const options = launchOptions(args);
  if (!options.packagedModelStore) await initializeEmptyModelStore(options.modelStoreDir);
  const core = await openCore(options);
  const daemon = await startDaemon(core, options.workspaceDir, {
    ...(options.windowsPipeGuardPath === undefined
      ? {}
      : { windowsPipeGuardPath: options.windowsPipeGuardPath }),
  });
  let stopParentMonitor: () => void = () => undefined;
  let shutdownPromise: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    shutdownPromise ??= (async () => {
      stopParentMonitor();
      await daemon.close();
      await core.close();
      if (options.readyFile !== undefined) await unlink(options.readyFile).catch(() => undefined);
    })();
    return shutdownPromise;
  }
  if (options.parentPid !== undefined) {
    stopParentMonitor = monitorParent({
      parentPid: options.parentPid,
      onExit: () => shutdown().finally(() => process.exit(0)),
    });
  }
  if (options.readyFile !== undefined) {
    const temporary = `${options.readyFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${daemon.endpoint}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, options.readyFile);
  }
  console.error(`Vault Core listening at ${daemon.endpoint}`);
  process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

const args = process.argv.slice(2);
if (args[0] === "debug-session") {
  void runDebugSessionMode(args).then((code) => {
    process.exitCode = code;
  });
} else {
  void startServer(args).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Vault Core failed to start.");
    process.exitCode = 1;
  });
}

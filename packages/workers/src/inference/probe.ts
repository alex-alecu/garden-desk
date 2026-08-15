import type { InferenceWorkerResponse, NativeWorkerProbeRequest } from "@vault/shared";

async function operationDenied(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return false;
  } catch {
    return true;
  }
}

function joinWindows(root: string, ...parts: string[]): string {
  return [root.replace(/[\\/]+$/u, ""), ...parts].join("\\");
}

function shellCommand(): string[] {
  return process.platform === "win32"
    ? [joinWindows(process.env.WINDIR ?? "C:\\Windows", "System32", "cmd.exe"), "/c", "exit 0"]
    : ["/bin/sh", "-c", "exit 0"];
}

function processDenial(error: unknown): { denied: boolean; evidence: string } {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.message
        : "unknown";
  const syscall = error instanceof Error && "syscall" in error ? String(error.syscall) : "unknown";
  const windowsJobDenied =
    process.platform === "win32" && code === "UNKNOWN" && syscall.startsWith("spawn");
  return {
    denied: windowsJobDenied || ["EACCES", "EAGAIN", "EPERM"].includes(code),
    evidence: `${code}:${syscall}`,
  };
}

async function processDenied(
  spawn: typeof import("node:child_process").spawn,
  command: string,
  arguments_: string[],
): Promise<{ denied: boolean; evidence: string }> {
  try {
    await new Promise<void>((accept, reject) => {
      const child = spawn(command, arguments_, {
        signal: AbortSignal.timeout(1_000),
        stdio: "ignore",
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) accept();
        else reject(new Error(`authority_probe_exit_${String(code)}`));
      });
    });
    return { denied: false, evidence: "process_exited_zero" };
  } catch (error) {
    return processDenial(error);
  }
}

async function executableToolsDenied(
  spawn: typeof import("node:child_process").spawn,
): Promise<{ denied: boolean; evidence: string }> {
  const shell = shellCommand();
  return processDenied(spawn, shell[0] as string, shell.slice(1));
}

function credentialsAbsent(): boolean {
  return Object.keys(process.env).every(
    (name) => !/TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY/iu.test(name),
  );
}

async function networkAccessDenied(): Promise<boolean> {
  const { connect } = await import("node:net");
  try {
    await new Promise<void>((accept, reject) => {
      const socket = connect({ host: "1.1.1.1", port: 443 });
      socket.once("connect", () => {
        socket.destroy();
        accept();
      });
      socket.once("error", reject);
      socket.setTimeout(1_000, () => socket.destroy(new Error("network_probe_timeout")));
    });
    return false;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EACCES" || error.code === "EPERM")
    );
  }
}

function failedProbeNames(
  probes: Record<string, boolean>,
  tools: { denied: boolean; evidence: string },
  nodeReexec: { denied: boolean; evidence: string },
): string[] {
  return Object.entries(probes)
    .filter(([, denied]) => !denied)
    .map(([name]) => {
      if (name === "executableToolsDenied") return `${name}:${tools.evidence}`;
      if (name === "nodeReexecDenied") return `${name}:${nodeReexec.evidence}`;
      return name;
    });
}

export async function probe(request: NativeWorkerProbeRequest): Promise<InferenceWorkerResponse> {
  const { spawn } = await import("node:child_process");
  const { readFile, writeFile } = await import("node:fs/promises");
  const networkDenied = await networkAccessDenied();
  const credentialEnvironmentAbsent = credentialsAbsent();
  const workspaceDenied = await operationDenied(() => readFile(request.authorityProbePath));
  const outOfScopeReadDenied = await operationDenied(() => readFile(request.outOfScopeReadPath));
  const outOfScopeWriteDenied = await operationDenied(() =>
    writeFile(request.outOfScopeWritePath, "denial probe", { flag: "wx" }),
  );
  const tools = await executableToolsDenied(spawn);
  const nodeReexec = await processDenied(spawn, process.execPath, ["-e", "process.exit(0)"]);
  const failed = failedProbeNames(
    {
      networkDenied,
      credentialEnvironmentAbsent,
      shellEnvironmentAbsent: process.env.SHELL === undefined && process.env.ComSpec === undefined,
      workspaceDenied,
      outOfScopeReadDenied,
      outOfScopeWriteDenied,
      executableToolsDenied: tools.denied,
      nodeReexecDenied: nodeReexec.denied,
    },
    tools,
    nodeReexec,
  );
  if (failed.length > 0) {
    throw new Error(`native_worker_authority_probe_failed:${failed.join(",")}`);
  }
  return {
    protocolVersion: 2,
    requestId: request.requestId,
    status: "ok",
    operation: "probe",
    networkDenied: true,
    credentialEnvironmentAbsent: true,
    shellEnvironmentAbsent: true,
    workspaceDenied: true,
    outOfScopeReadDenied: true,
    outOfScopeWriteDenied: true,
    executableToolsDenied: true,
    nodeReexecDenied: true,
  };
}

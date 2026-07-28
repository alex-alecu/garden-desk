import type { AgentExecutionResult, WorkerLimits } from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";

const limits: WorkerLimits = {
  wallTimeMs: 30_000,
  inputCount: 4,
  inputBytes: 8 * 1024 * 1024,
  memoryBytes: 2 * 1024 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  cpuCount: 2,
};

const PROCESS_LIMIT_PROBE = [
  "import subprocess",
  "children = []",
  "try:",
  "    for _ in range(64):",
  "        children.append(subprocess.Popen(['/bin/sleep', '60']))",
  "except OSError:",
  "    pass",
  "print(len(children))",
].join("\n");

const WORKSPACE_QUOTA_PROBE = [
  "import pathlib",
  "path = pathlib.Path('quota.bin')",
  "blocked = False",
  "try:",
  "    with path.open('wb') as output:",
  "        for _ in range(129): output.write(b'x' * (1024 * 1024))",
  "except OSError:",
  "    blocked = True",
  "finally:",
  "    path.unlink(missing_ok=True)",
  "print(blocked)",
].join("\n");

const MEMORY_LIMIT_PROBE = [
  "blocked = False",
  "try:",
  "    bytearray(3 * 1024 * 1024 * 1024)",
  "except MemoryError:",
  "    blocked = True",
  "print(blocked)",
].join("\n");

export function requireIsolationProof(
  proof: Record<string, unknown>,
  python: AgentExecutionResult,
): void {
  if (
    proof.input !== "read-only evidence" ||
    proof.writeBlocked !== true ||
    proof.rootWriteBlocked !== true ||
    proof.tmpWriteBlocked !== true ||
    proof.outsideWritesBlocked !== true ||
    proof.runtimeWritable !== true ||
    proof.networkBlocked !== true ||
    proof.ipv6Blocked !== true ||
    proof.dnsBlocked !== true ||
    proof.vsockBlocked !== true ||
    proof.unixBlocked !== true ||
    proof.socketpairBlocked !== true ||
    proof.packageManagersAbsent !== true ||
    proof.shellAvailable !== true ||
    proof.credentialsAbsent !== true ||
    proof.hostPathsAbsent !== true ||
    proof.nestedFiles !== 65 ||
    proof.sparseBytes !== 513 * 1024 * 1024 ||
    python.artifacts[0]?.name !== "python-result.json"
  ) {
    throw new Error("Python guest isolation, live source, or runtime proof failed.");
  }
}

async function boundedProcessProbes(launcher: CodeAgentLauncher, sourceFolder: string) {
  const session = await launcher.openAgentSession({
    sessionId: "00000000-0000-4000-8000-000000000036",
    sourceFolder,
    readonlyInputs: [],
    limits,
  });
  try {
    const storm = await session.execute({
      language: "python",
      path: "steps/process-limit.py",
      source: PROCESS_LIMIT_PROBE,
    });
    const count = Number(storm.stdout.trim());
    if (storm.termination !== "completed" || count < 1 || count >= 64) {
      throw new Error("Guest process limit proof failed.");
    }
    const memory = await session.execute({
      language: "python",
      path: "steps/memory-limit.py",
      source: MEMORY_LIMIT_PROBE,
    });
    if (memory.termination !== "completed" || memory.stdout.trim() !== "True") {
      throw new Error("Guest memory limit proof failed.");
    }
    const quota = await session.execute({
      language: "python",
      path: "steps/workspace-quota.py",
      source: WORKSPACE_QUOTA_PROBE,
    });
    if (quota.termination !== "completed" || quota.stdout.trim() !== "True") {
      throw new Error("Guest workspace quota proof failed.");
    }
    const crash = await session.execute({ language: "shell", command: "kill -SEGV $$" });
    if (crash.termination !== "crash") throw new Error("Guest crash containment proof failed.");
    return {
      processCount: count,
      memory: "blocked",
      quota: "blocked",
      crash: crash.termination,
    };
  } finally {
    await session.close();
  }
}

async function escapingLinkProbe(launcher: CodeAgentLauncher, sourceFolder: string) {
  const session = await launcher.openAgentSession({
    sessionId: "00000000-0000-4000-8000-000000000037",
    sourceFolder,
    readonlyInputs: [],
    limits,
  });
  try {
    await session.execute({ language: "shell", command: "ln -s /source/input.txt escape" });
    throw new Error("Guest escaping link was accepted.");
  } catch (error) {
    if (error instanceof Error && error.message === "Guest escaping link was accepted.")
      throw error;
    return "rejected";
  } finally {
    await session.close().catch(() => undefined);
  }
}

export async function runGuestSecurityEvidence(launcher: CodeAgentLauncher, sourceFolder: string) {
  return {
    ...(await boundedProcessProbes(launcher, sourceFolder)),
    symlink: await escapingLinkProbe(launcher, sourceFolder),
  };
}

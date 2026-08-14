import { mkdir, open, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerLimits } from "@vault/shared";
import type { CodeAgentLauncher, CodeAgentSession, MicroVmAgentRequest } from "@vault/workers";
import { createLegacyDocFixture } from "../fixtures/legacy-doc.js";
import { documentLibraryProbe } from "./m3-guest-documents.js";
import { requireGuestSuccess } from "./m3-guest-execution.js";
import { requireIsolationProof, runGuestSecurityEvidence } from "./m3-guest-security.js";

const limits: WorkerLimits = {
  wallTimeMs: 30_000,
  inputCount: 4,
  inputBytes: 8 * 1024 * 1024,
  memoryBytes: 2 * 1024 * 1024 * 1024,
  scratchBytes: 128 * 1024 * 1024,
  outputBytes: 8 * 1024 * 1024,
  cpuCount: 2,
};

async function withSession<T>(
  launcher: CodeAgentLauncher,
  request: MicroVmAgentRequest,
  operation: (session: CodeAgentSession) => Promise<T>,
): Promise<T> {
  const session = await launcher.openAgentSession(request);
  try {
    return await operation(session);
  } finally {
    await session.close();
  }
}

async function prepareSource(root: string): Promise<string> {
  const source = join(root, "source");
  const nested = join(source, "nested", "deep");
  await mkdir(nested, { recursive: true });
  await Promise.all(
    Array.from({ length: 65 }, async (_, index) => {
      await writeFile(join(nested, `file-${index}.txt`), `file ${index}`);
    }),
  );
  const sparse = join(nested, "large.sparse");
  await (await open(sparse, "wx")).close();
  await truncate(sparse, 513 * 1024 * 1024);
  await writeFile(join(source, "input.txt"), "read-only evidence");
  await createLegacyDocFixture(source);
  return source;
}

const PYTHON_PROBE = [
  "import json, os, pathlib, shutil, socket",
  "import PIL, pypdf, openpyxl, docx, reportlab, charset_normalizer",
  "root = pathlib.Path(os.environ['VAULT_SOURCE_DIR'])",
  "source = root / 'input.txt'",
  "write_blocked = False",
  "try:",
  "    source.write_text('changed')",
  "except OSError:",
  "    write_blocked = True",
  "root_write_blocked = False",
  "try:",
  "    pathlib.Path('/etc/vault-write-probe').write_text('changed')",
  "except OSError:",
  "    root_write_blocked = True",
  "tmp_write_blocked = False",
  "try:",
  "    pathlib.Path('/tmp/vault-write-probe').write_text('changed')",
  "except OSError:",
  "    tmp_write_blocked = True",
  "outside_writes_blocked = True",
  "for directory in ['/var/tmp', '/dev/shm', '/run', '/home', '/dev']:",
  "    try:",
  "        probe = pathlib.Path(directory) / 'vault-write-probe'",
  "        probe.write_text('changed')",
  "        probe.unlink(missing_ok=True)",
  "        outside_writes_blocked = False",
  "    except OSError:",
  "        pass",
  "runtime = pathlib.Path('/run/user/vault-write-probe')",
  "runtime.write_text('ephemeral')",
  "runtime_writable = runtime.read_text() == 'ephemeral'",
  "runtime.unlink()",
  "network_blocked = False",
  "ipv6_blocked = False",
  "dns_blocked = False",
  "vsock_blocked = False",
  "unix_blocked = False",
  "socketpair_blocked = False",
  "try:",
  "    socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
  "except OSError:",
  "    network_blocked = True",
  "try:",
  "    socket.socket(socket.AF_INET6, socket.SOCK_STREAM)",
  "except OSError:",
  "    ipv6_blocked = True",
  "try:",
  "    socket.getaddrinfo('vault-network-probe.invalid', 443)",
  "except OSError:",
  "    dns_blocked = True",
  "try:",
  "    socket.socket(getattr(socket, 'AF_VSOCK', 40), socket.SOCK_STREAM)",
  "except OSError:",
  "    vsock_blocked = True",
  "try:",
  "    socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)",
  "except OSError:",
  "    unix_blocked = True",
  "try:",
  "    socket.socketpair()",
  "except OSError:",
  "    socketpair_blocked = True",
  "artifact = pathlib.Path(os.environ['VAULT_WORKSPACE_DIR']) / 'python-result.json'",
  "result = {'input': source.read_text(), 'writeBlocked': write_blocked, 'rootWriteBlocked': root_write_blocked, 'tmpWriteBlocked': tmp_write_blocked, 'outsideWritesBlocked': outside_writes_blocked, 'runtimeWritable': runtime_writable, 'networkBlocked': network_blocked, 'ipv6Blocked': ipv6_blocked, 'dnsBlocked': dns_blocked, 'vsockBlocked': vsock_blocked, 'unixBlocked': unix_blocked, 'socketpairBlocked': socketpair_blocked, 'packageManagersAbsent': all(shutil.which(name) is None for name in ['pip', 'npm', 'corepack', 'apk', 'apt', 'dnf', 'yum']), 'shellAvailable': shutil.which('sh') is not None, 'credentialsAbsent': all(key not in os.environ for key in ['AWS_ACCESS_KEY_ID', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK']), 'hostPathsAbsent': not pathlib.Path('/Users').exists(), 'nestedFiles': len(list((root / 'nested' / 'deep').glob('file-*.txt'))), 'sparseBytes': (root / 'nested' / 'deep' / 'large.sparse').stat().st_size, 'versions': [PIL.__version__, pypdf.__version__, openpyxl.__version__, docx.__version__, reportlab.Version, charset_normalizer.__version__]}",
  "artifact.write_text(json.dumps(result))",
  "print(json.dumps(result))",
].join("\n");

async function cancellationProbe(launcher: CodeAgentLauncher, source: string) {
  const result = await withSession(
    launcher,
    {
      sessionId: "00000000-0000-4000-8000-000000000035",
      sourceFolder: source,
      readonlyInputs: [],
      limits,
    },
    async (session) => {
      const pending = session.execute({ language: "shell", command: "sleep 60" });
      setTimeout(() => void session.cancel(), 200);
      return await pending;
    },
  );
  if (result.termination !== "cancelled") throw new Error("Guest cancellation proof failed.");
  return result.termination;
}

async function boundedExecutionProbes(launcher: CodeAgentLauncher, source: string) {
  console.error("m3_guest_stage:execution_timeout");
  const timeout = await withSession(
    launcher,
    {
      sessionId: "00000000-0000-4000-8000-000000000033",
      sourceFolder: source,
      readonlyInputs: [],
      limits: { ...limits, wallTimeMs: 250 },
    },
    async (session) =>
      await session.execute({
        language: "python",
        path: "steps/timeout.py",
        source: "import time\ntime.sleep(60)",
      }),
  );
  if (timeout.termination !== "timeout") throw new Error("Guest timeout proof failed.");
  console.error("m3_guest_stage:execution_output");
  const output = await withSession(
    launcher,
    {
      sessionId: "00000000-0000-4000-8000-000000000034",
      sourceFolder: source,
      readonlyInputs: [],
      limits,
    },
    async (session) =>
      await session.execute({
        language: "python",
        path: "steps/output.py",
        source: "print('x' * (12 * 1024 * 1024))",
      }),
  );
  if (output.termination !== "resource_limit") throw new Error("Guest output proof failed.");
  return { timeout: timeout.termination, output: output.termination };
}

async function isolationProbe(session: CodeAgentSession) {
  const python = await session.execute({
    language: "python",
    path: "steps/probe.py",
    source: PYTHON_PROBE,
  });
  requireGuestSuccess(python);
  const proof = JSON.parse(python.stdout) as Record<string, unknown>;
  requireIsolationProof(proof, python);
  return { proof, artifacts: python.artifacts.length };
}

async function languageAndRepairProbes(session: CodeAgentSession, source: string) {
  const failed = await session.execute({
    language: "python",
    path: "steps/repair.py",
    source: "print(missing)",
  });
  if (failed.exitCode === 0) throw new Error("Guest repair failure probe did not fail.");
  const repaired = await session.execute({
    language: "python",
    path: "steps/repair.py",
    source: "print('repaired')",
  });
  requireGuestSuccess(repaired);
  const node = await session.execute({
    language: "node",
    path: "steps/probe.mjs",
    source: [
      "import fs from 'node:fs';",
      "const major = Number(process.versions.node.split('.')[0]);",
      "const npmAbsent = !fs.existsSync('/usr/bin/npm');",
      "fs.writeFileSync('node-result.json', JSON.stringify({major, npmAbsent}));",
      "console.log(JSON.stringify({major, npmAbsent}));",
    ].join("\n"),
  });
  requireGuestSuccess(node);
  const nodeProof = JSON.parse(node.stdout) as { major: number; npmAbsent: boolean };
  if (nodeProof.major !== 24 || !nodeProof.npmAbsent) throw new Error("Node runtime proof failed.");
  await writeFile(join(source, "input.txt"), "live edit evidence");
  const shell = await session.execute({
    language: "shell",
    command: "grep 'live edit' /source/input.txt | grep evidence && test -f python-result.json",
  });
  requireGuestSuccess(shell);
  return { repaired: repaired.stdout.trim(), nodeProof, shell: shell.stdout.trim() };
}

async function persistentFileProbe(session: CodeAgentSession): Promise<void> {
  const result = await session.execute({
    language: "python",
    path: "steps/large-file.py",
    source:
      "with open('large.bin', 'wb') as output:\n    output.truncate(9 * 1024 * 1024)\nprint('large file written')",
  });
  requireGuestSuccess(result);
}

async function rehydrationProbe(
  launcher: CodeAgentLauncher,
  source: string,
  sessionId: string,
): Promise<string> {
  const result = await withSession(
    launcher,
    { sessionId, sourceFolder: source, readonlyInputs: [], limits },
    async (session) =>
      await session.execute({
        language: "shell",
        command:
          "test -f steps/probe.py && test -f steps/repair.py && test -f large.bin && /usr/bin/python3 steps/repair.py",
      }),
  );
  requireGuestSuccess(result);
  return result.stdout.trim();
}

export async function runGuestEvidence(
  root: string,
  launcherForWorkspace: (workspace: string) => CodeAgentLauncher,
) {
  const source = await prepareSource(root);
  const workspaceStore = join(root, "workspace-store");
  const launcher = launcherForWorkspace(workspaceStore);
  const sessionId = "00000000-0000-4000-8000-000000000031";
  console.error("m3_guest_stage:primary");
  const primary = await withSession(
    launcher,
    { sessionId, sourceFolder: source, readonlyInputs: [], limits },
    async (session) => {
      const isolation = await isolationProbe(session);
      const documents = await documentLibraryProbe(session);
      const language = await languageAndRepairProbes(session, source);
      await persistentFileProbe(session);
      return { documents, isolation, language };
    },
  );
  console.error("m3_guest_stage:rehydration");
  const persistence = await rehydrationProbe(
    launcherForWorkspace(workspaceStore),
    source,
    sessionId,
  );
  console.error("m3_guest_stage:cancellation");
  const cancelled = await cancellationProbe(launcher, source);
  console.error("m3_guest_stage:execution_limits");
  const bounded = await boundedExecutionProbes(launcher, source);
  console.error("m3_guest_stage:security");
  const security = await runGuestSecurityEvidence(launcher, source);
  return {
    python: primary.isolation.proof,
    documents: primary.documents,
    node: primary.language.nodeProof,
    shell: primary.language.shell,
    repair: primary.language.repaired,
    persistence,
    cancelled,
    bounded,
    security,
    artifactCount: primary.isolation.artifacts,
  };
}

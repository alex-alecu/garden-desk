import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceWorkerRequestSchema } from "@vault/shared";
import {
  InferenceWorkerClient,
  WindowsNativeWorkerLauncher,
  windowsNativeWorkerEntryPath,
} from "@vault/workers";
import { describe, expect, it } from "vitest";

const itWindows = process.platform === "win32" && process.arch === "x64" ? it : it.skip;

function requireProbeSuccess(response: Awaited<ReturnType<InferenceWorkerClient["execute"]>>) {
  if (response.status === "error")
    throw new Error(`${response.error.code}: ${response.error.message}`);
}

async function removeProbeFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })));
}

async function runAuthorityProbe() {
  const workspaceRoot = join(tmpdir(), `vault-m2-workspace-${randomUUID()}`);
  const sentinel = join(workspaceRoot, "authority-sentinel.txt");
  const outOfScopeReadPath = join(tmpdir(), `vault-m2-read-denied-${randomUUID()}`);
  const outOfScopeWritePath = join(tmpdir(), `vault-m2-out-of-scope-${randomUUID()}`);
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(sentinel, "must remain unreadable");
  await writeFile(outOfScopeReadPath, "must remain unreadable outside job scratch");
  const request = InferenceWorkerRequestSchema.parse({
    protocolVersion: 2,
    requestId: "m2-native-probe",
    jobId: "00000000-0000-4000-8000-000000000002",
    operation: "probe",
    authorityProbePath: sentinel,
    outOfScopeReadPath,
    outOfScopeWritePath,
  });
  const client = new InferenceWorkerClient(
    new WindowsNativeWorkerLauncher(),
    windowsNativeWorkerEntryPath(),
  );
  let response: Awaited<ReturnType<typeof client.execute>>;
  try {
    response = await client.execute({
      request,
      memoryBudgetBytes: 12 * 1024 * 1024 * 1024,
      timeoutMs: 60_000,
    });
  } finally {
    await removeProbeFiles([outOfScopeReadPath, outOfScopeWritePath, workspaceRoot]);
  }
  requireProbeSuccess(response);
  expect(response).toMatchObject({
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
  });
}

describe("M2 Windows native inference boundary", () => {
  itWindows(
    "denies network, workspace, credential, shell, and executable-tool authority",
    runAuthorityProbe,
    180_000,
  );
});

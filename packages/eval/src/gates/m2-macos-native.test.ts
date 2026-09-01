import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { InferenceWorkerRequestSchema } from "@gardendesk/shared";
import { InferenceWorkerClient, MacOsNativeWorkerLauncher } from "@gardendesk/workers";
import { describe, expect, it } from "vitest";

const itMac = process.platform === "darwin" && process.arch === "arm64" ? it : it.skip;

describe("M2 macOS native inference boundary", () => {
  itMac("denies network, workspace, credential, shell, and executable-tool authority", async () => {
    const sentinel = join(process.cwd(), "packages/eval/.generated/m2-authority-sentinel.txt");
    const outOfScopeReadPath = join(tmpdir(), `garden-desk-m2-read-denied-${randomUUID()}`);
    const outOfScopeWritePath = join(tmpdir(), `garden-desk-m2-out-of-scope-${randomUUID()}`);
    await mkdir(join(process.cwd(), "packages/eval/.generated"), { recursive: true });
    await writeFile(sentinel, "must remain unreadable");
    await writeFile(outOfScopeReadPath, "must remain unreadable outside the user home");
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
      new MacOsNativeWorkerLauncher([dirname(sentinel)]),
      join(process.cwd(), "packages/workers/dist/inference/worker.js"),
    );
    let response: Awaited<ReturnType<typeof client.execute>>;
    try {
      response = await client.execute({
        request,
        memoryBudgetBytes: 12 * 1024 * 1024 * 1024,
        timeoutMs: 30_000,
      });
    } finally {
      await Promise.all([
        rm(outOfScopeReadPath, { force: true }),
        rm(outOfScopeWritePath, { force: true }),
      ]);
    }
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
  });
});

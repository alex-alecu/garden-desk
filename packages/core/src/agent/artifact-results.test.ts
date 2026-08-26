// biome-ignore lint/style/noRestrictedImports: isolated artifact fixtures use temporary files.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult } from "@vault/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../workspace/artifacts.js";
import { WorkspaceScope } from "../workspace/scope.js";
import {
  artifactCandidateNames,
  currentArtifactOutputs,
  prepareArtifacts,
} from "./artifact-results.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function artifactStore(): Promise<ArtifactStore> {
  const root = await mkdtemp(join(tmpdir(), "vault-artifact-results-test-"));
  roots.push(root);
  return await ArtifactStore.create(await WorkspaceScope.create(root));
}

function result(
  name: string,
  options: Pick<AgentExecutionResult, "exitCode" | "termination">,
  content = name,
): AgentExecutionResult {
  return {
    language: "python",
    path: ".vault-tools/test.py",
    source: "print('ok')",
    command: null,
    exitCode: options.exitCode,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: options.termination,
    artifacts: [
      {
        name,
        mediaType: "application/octet-stream",
        bytesBase64: Buffer.from(content).toString("base64"),
      },
    ],
  };
}

function recoverable(path: string): AgentExecutionResult {
  const execution = result("unused.unknown", { exitCode: 0, termination: "completed" });
  execution.artifacts = [];
  execution.recoverableArtifactPaths = [path];
  return execution;
}

describe("current artifact results", () => {
  it("uses artifacts from successful executions only", () => {
    const failed = result("failed.unknown", { exitCode: 1, termination: "completed" });
    const incomplete = result("incomplete.unknown", { exitCode: 0, termination: "crash" });
    const success = result("retained.unknown", { exitCode: 0, termination: "completed" });
    success.stdoutTruncated = true;

    expect(artifactCandidateNames([failed, incomplete, success])).toEqual(["retained.unknown"]);
    expect([...currentArtifactOutputs([failed, incomplete, success]).keys()]).toEqual([
      "retained.unknown",
    ]);
  });

  it("removes a successful artifact after a failed execution deletes it", () => {
    const created = result("report.unknown", { exitCode: 0, termination: "completed" });
    const deleted = result("failed.unknown", { exitCode: 1, termination: "completed" });
    deleted.artifacts = [];
    deleted.invalidatedArtifactPaths = ["report.unknown"];

    expect(artifactCandidateNames([created, deleted])).toEqual([]);
  });

  it("removes a successful artifact after a failed execution replaces it", () => {
    const created = result("report.unknown", { exitCode: 0, termination: "completed" });
    const replacement = result(
      "report.unknown",
      { exitCode: 1, termination: "completed" },
      "failed replacement",
    );
    replacement.invalidatedArtifactPaths = ["report.unknown"];

    expect(artifactCandidateNames([created, replacement])).toEqual([]);
  });

  it("keeps a valid artifact after an unrelated failed execution", () => {
    const created = result("report.unknown", { exitCode: 0, termination: "completed" });
    const failed = result("failed.unknown", { exitCode: 1, termination: "completed" });
    failed.invalidatedArtifactPaths = ["unrelated.unknown"];

    expect(artifactCandidateNames([created, failed])).toEqual(["report.unknown"]);
  });

  it("publishes a recoverable artifact from the final successful execution", () => {
    const success = result("unused.unknown", { exitCode: 0, termination: "completed" });
    success.artifacts = [];
    success.recoverableArtifactPaths = ["report.unknown"];

    expect(artifactCandidateNames([success])).toEqual(["report.unknown"]);
  });
});

describe("current artifact replacement", () => {
  it("restores an invalidated artifact after a later successful recreation", () => {
    const created = result("report.unknown", { exitCode: 0, termination: "completed" });
    const deleted = result("failed.unknown", { exitCode: 124, termination: "timeout" });
    deleted.artifacts = [];
    deleted.invalidatedArtifactPaths = ["report.unknown"];
    const recreated = result(
      "report.unknown",
      { exitCode: 0, termination: "completed" },
      "recreated",
    );

    expect(currentArtifactOutputs([created, deleted, recreated]).get("report.unknown")).toEqual({
      name: "report.unknown",
      bytesBase64: Buffer.from("recreated").toString("base64"),
    });
  });

  it("keeps a recently regenerated artifact inside the 16-card limit", () => {
    const created = Array.from({ length: 16 }, (_, index) =>
      result(`report-${index + 1}.unknown`, { exitCode: 0, termination: "completed" }),
    );
    const regenerated = result(
      "report-1.unknown",
      { exitCode: 0, termination: "completed" },
      "new bytes",
    );
    const added = result("report-17.unknown", { exitCode: 0, termination: "completed" });

    const names = artifactCandidateNames([...created, regenerated, added]);

    expect(names).toHaveLength(16);
    expect(names).toContain("report-1.unknown");
    expect(names).toContain("report-17.unknown");
    expect(names).not.toContain("report-2.unknown");
  });
});

describe("artifact path policy", () => {
  it("does not expose working scripts as user artifacts", () => {
    const script = result("steps/repair.py", { exitCode: 0, termination: "completed" });

    expect(artifactCandidateNames([script])).toEqual([]);
  });
});

describe("failed artifact recovery", () => {
  it("restores output after a later unchanged success", () => {
    const failed = result(
      "report.unknown",
      { exitCode: 1, termination: "completed" },
      "complete bytes written before failure",
    );
    failed.invalidatedArtifactPaths = ["report.unknown"];
    const laterSuccess = result("unused.unknown", {
      exitCode: 0,
      termination: "completed",
    });
    laterSuccess.artifacts = [];

    expect(currentArtifactOutputs([failed])).toEqual(new Map());
    expect(currentArtifactOutputs([failed, laterSuccess]).get("report.unknown")).toEqual({
      name: "report.unknown",
      bytesBase64: Buffer.from("complete bytes written before failure").toString("base64"),
    });
  });

  it("does not restore failed output after a later removal", () => {
    const failed = result("report.unknown", { exitCode: 1, termination: "completed" });
    failed.invalidatedArtifactPaths = ["report.unknown"];
    const removed = result("unused.unknown", { exitCode: 1, termination: "completed" });
    removed.artifacts = [];
    removed.invalidatedArtifactPaths = ["report.unknown"];
    const laterSuccess = result("unused.unknown", {
      exitCode: 0,
      termination: "completed",
    });
    laterSuccess.artifacts = [];

    expect(currentArtifactOutputs([failed, removed, laterSuccess])).toEqual(new Map());
  });
});

describe("recoverable artifact preparation", () => {
  it("stores the exact bytes read from the committed workspace", async () => {
    const artifacts = await artifactStore();
    const bytes = Buffer.from([0, 1, 2, 254, 255]);

    const prepared = await prepareArtifacts(
      ["report.bin"],
      [recoverable("report.bin")],
      artifacts,
      async () => bytes,
    );

    expect(prepared).toHaveLength(1);
    const artifact = prepared[0];
    if (artifact === undefined) throw new Error("missing_prepared_artifact");
    expect(await artifacts.read(artifact.contentHash)).toEqual(bytes);
  });

  it("skips a recoverable artifact when the workspace file is missing", async () => {
    const prepared = await prepareArtifacts(
      ["missing.bin"],
      [recoverable("missing.bin")],
      await artifactStore(),
      async () => undefined,
    );

    expect(prepared).toEqual([]);
  });
});

describe("recoverable artifact size limit", () => {
  it("accepts a recoverable artifact at the 8 MiB limit", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    const prepared = await prepareArtifacts(
      ["limit.bin"],
      [recoverable("limit.bin")],
      await artifactStore(),
      async () => bytes,
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.byteLength).toBe(bytes.byteLength);
  });

  it("skips a recoverable artifact above the 8 MiB limit", async () => {
    const prepared = await prepareArtifacts(
      ["too-large.bin"],
      [recoverable("too-large.bin")],
      await artifactStore(),
      async () => Buffer.alloc(8 * 1024 * 1024 + 1),
    );

    expect(prepared).toEqual([]);
  });
});

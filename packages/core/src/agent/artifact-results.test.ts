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

function result(name: string, content = name): Pick<AgentExecutionResult, "artifacts"> {
  return {
    artifacts: [
      {
        name,
        mediaType: "application/octet-stream",
        bytesBase64: Buffer.from(content).toString("base64"),
      },
    ],
  };
}

describe("current artifact results", () => {
  it("collects every reported artifact name and bytes across executions", () => {
    const first = result("report.unknown");
    const second = result("summary.unknown");

    expect(artifactCandidateNames([first, second])).toEqual(["report.unknown", "summary.unknown"]);
    expect([...currentArtifactOutputs([first, second]).keys()]).toEqual([
      "report.unknown",
      "summary.unknown",
    ]);
  });

  it("keeps the latest bytes when a later execution rewrites the same name", () => {
    const created = result("report.unknown", "first");
    const rewritten = result("report.unknown", "second");

    expect(currentArtifactOutputs([created, rewritten]).get("report.unknown")).toEqual({
      name: "report.unknown",
      bytesBase64: Buffer.from("second").toString("base64"),
    });
  });
});

describe("current artifact replacement", () => {
  it("keeps a recently regenerated artifact inside the 16-card limit", () => {
    const created = Array.from({ length: 16 }, (_, index) => result(`report-${index + 1}.unknown`));
    const regenerated = result("report-1.unknown", "new bytes");
    const added = result("report-17.unknown");

    const names = artifactCandidateNames([...created, regenerated, added]);

    expect(names).toHaveLength(16);
    expect(names).toContain("report-1.unknown");
    expect(names).toContain("report-17.unknown");
    expect(names).not.toContain("report-2.unknown");
  });
});

describe("artifact path policy", () => {
  it("does not expose working scripts as user artifacts", () => {
    const script = result("steps/repair.py");

    expect(artifactCandidateNames([script])).toEqual([]);
  });
});

describe("artifact preparation", () => {
  it("stores the exact bytes reported by the execution", async () => {
    const artifacts = await artifactStore();

    const prepared = await prepareArtifacts(
      ["report.bin"],
      [result("report.bin", "committed bytes")],
      artifacts,
    );

    expect(prepared).toHaveLength(1);
    const artifact = prepared[0];
    if (artifact === undefined) throw new Error("missing_prepared_artifact");
    expect(await artifacts.read(artifact.contentHash)).toEqual(Buffer.from("committed bytes"));
  });

  it("falls back to the live workspace file for a name absent from the given executions", async () => {
    const artifacts = await artifactStore();
    const bytes = Buffer.from([0, 1, 2, 254, 255]);

    const prepared = await prepareArtifacts(["report.bin"], [], artifacts, async () => bytes);

    expect(prepared).toHaveLength(1);
    const artifact = prepared[0];
    if (artifact === undefined) throw new Error("missing_prepared_artifact");
    expect(await artifacts.read(artifact.contentHash)).toEqual(bytes);
  });

  it("skips a name missing from both the executions and the workspace", async () => {
    const prepared = await prepareArtifacts(
      ["missing.bin"],
      [],
      await artifactStore(),
      async () => undefined,
    );

    expect(prepared).toEqual([]);
  });
});

describe("artifact size limit", () => {
  it("accepts an artifact at the 8 MiB limit", async () => {
    const bytes = Buffer.alloc(8 * 1024 * 1024, 7);
    const prepared = await prepareArtifacts(
      ["limit.bin"],
      [],
      await artifactStore(),
      async () => bytes,
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.byteLength).toBe(bytes.byteLength);
  });

  it("skips an artifact above the 8 MiB limit", async () => {
    const prepared = await prepareArtifacts(
      ["too-large.bin"],
      [],
      await artifactStore(),
      async () => Buffer.alloc(8 * 1024 * 1024 + 1),
    );

    expect(prepared).toEqual([]);
  });
});

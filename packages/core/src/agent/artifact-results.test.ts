import type { AgentExecutionResult } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { artifactCandidateNames, currentArtifactOutputs } from "./artifact-results.js";

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
});

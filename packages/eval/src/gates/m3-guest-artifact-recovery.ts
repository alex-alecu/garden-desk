import type { AgentExecutionResult } from "@vault/shared";
import type { CodeAgentSession } from "@vault/workers";
import { requireM3ProductCheck } from "./m3-canonical-gate-reporting.js";
import { requireGuestSuccess } from "./m3-guest-execution.js";

function artifactText(result: AgentExecutionResult, name: string): string | undefined {
  const artifact = result.artifacts.find((item) => item.name === name);
  return artifact === undefined
    ? undefined
    : Buffer.from(artifact.bytesBase64, "base64").toString();
}

function requireFailedChange(result: AgentExecutionResult, name: string, expected: string): void {
  requireM3ProductCheck(
    result.termination === "crash" && result.exitCode !== 0,
    "Guest artifact failure probe did not fail after writing.",
  );
  requireM3ProductCheck(
    result.invalidatedArtifactPaths?.includes(name) === true,
    "Guest artifact failure did not invalidate the changed path.",
  );
  requireM3ProductCheck(
    artifactText(result, name) === expected,
    "Guest artifact failure did not return the changed bytes.",
  );
}

function requireSuccessfulArtifact(
  result: AgentExecutionResult,
  name: string,
  expected: string,
): void {
  requireGuestSuccess(result);
  requireM3ProductCheck(
    artifactText(result, name) === expected,
    "Guest artifact recovery did not return the expected bytes.",
  );
}

async function seedFailedWorkspace(session: CodeAgentSession): Promise<void> {
  const failedPersistence = await session.execute({
    language: "python",
    path: "steps/artifact-persistence.py",
    source: [
      "from pathlib import Path",
      'Path("failed-persistence.txt").write_text("persisted-after-failure")',
      'raise RuntimeError("fail after persistent write")',
    ].join("\n"),
  });
  requireFailedChange(failedPersistence, "failed-persistence.txt", "persisted-after-failure");
}

async function recoverFailedCreation(session: CodeAgentSession): Promise<void> {
  const failedCreate = await session.execute({
    language: "python",
    path: "steps/artifact-create.py",
    source: [
      "from pathlib import Path",
      'Path("recovered.txt").write_text("stable")',
      'raise RuntimeError("fail after write")',
    ].join("\n"),
  });
  requireFailedChange(failedCreate, "recovered.txt", "stable");
  const recovered = await session.execute({
    language: "python",
    path: "steps/artifact-create.py",
    source: 'from pathlib import Path\nPath("recovered.txt").write_text("stable")',
  });
  requireSuccessfulArtifact(recovered, "recovered.txt", "stable");
}

async function restoreFailedReplacement(session: CodeAgentSession): Promise<void> {
  const original = await session.execute({
    language: "python",
    path: "steps/artifact-replace.py",
    source: 'from pathlib import Path\nPath("replacement.txt").write_text("original")',
  });
  requireSuccessfulArtifact(original, "replacement.txt", "original");
  const failedReplacement = await session.execute({
    language: "python",
    path: "steps/artifact-replace.py",
    source: [
      "from pathlib import Path",
      'Path("replacement.txt").write_text("failed replacement")',
      'raise RuntimeError("fail after replacement")',
    ].join("\n"),
  });
  requireFailedChange(failedReplacement, "replacement.txt", "failed replacement");
  const restored = await session.execute({
    language: "python",
    path: "steps/artifact-replace.py",
    source: 'from pathlib import Path\nPath("replacement.txt").write_text("original")',
  });
  requireSuccessfulArtifact(restored, "replacement.txt", "original");
}

async function recoverSuccessfulArtifactLimit(session: CodeAgentSession): Promise<void> {
  const source = [
    "from pathlib import Path",
    'for index in range(17): Path(f"limited-{index:02}.txt").write_text(str(index))',
  ].join("\n");
  const limited = await session.execute({
    language: "python",
    path: "steps/artifact-limit.py",
    source,
  });
  requireGuestSuccess(limited);
  requireM3ProductCheck(limited.artifacts.length === 16, "Guest artifact count limit failed.");
  requireM3ProductCheck(
    limited.invalidatedArtifactPaths?.includes("limited-16.txt") === true,
    "Guest artifact limit did not invalidate the omitted path.",
  );
  const recovered = await session.execute({
    language: "python",
    path: "steps/artifact-limit.py",
    source,
  });
  requireSuccessfulArtifact(recovered, "limited-16.txt", "16");
}

export async function guestArtifactRecoveryEvidence(session: CodeAgentSession) {
  await seedFailedWorkspace(session);
  await recoverFailedCreation(session);
  await restoreFailedReplacement(session);
  await recoverSuccessfulArtifactLimit(session);

  return {
    failedWorkspaceSeeded: true,
    failedCreationInvalidated: true,
    byteIdenticalCreationRecovered: true,
    failedReplacementInvalidated: true,
    earlierBytesRestored: true,
    successfulLimitOmissionRecovered: true,
  };
}

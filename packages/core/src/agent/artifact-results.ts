import {
  type AgentArtifactSummary,
  type AgentExecutionResult,
  isUserArtifactWorkspacePath,
} from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { attachmentMediaType } from "./records.js";

const MAX_CURRENT_ARTIFACTS = 16;

interface ArtifactOutput {
  name: string;
  bytesBase64: string;
}

/** Every execution reports the `/workspace` files it changed; that is the whole artifact rule. */
export type ArtifactExecutionEvidence = Pick<AgentExecutionResult, "artifacts">;

function currentArtifactCandidates(
  executions: readonly ArtifactExecutionEvidence[],
): Map<string, ArtifactOutput> {
  const current = new Map<string, ArtifactOutput>();
  for (const execution of executions) {
    for (const artifact of execution.artifacts) {
      if (!isUserArtifactWorkspacePath(artifact.name)) continue;
      current.delete(artifact.name);
      current.set(artifact.name, { name: artifact.name, bytesBase64: artifact.bytesBase64 });
    }
  }
  return current;
}

export function artifactCandidateNames(executions: readonly ArtifactExecutionEvidence[]): string[] {
  return [...currentArtifactCandidates(executions).keys()].slice(-MAX_CURRENT_ARTIFACTS);
}

export async function prepareArtifacts(
  names: readonly string[],
  executions: readonly ArtifactExecutionEvidence[],
  artifacts: ArtifactStore,
  readWorkspaceFile?: (path: string) => Promise<Buffer | undefined>,
): Promise<Array<Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">>> {
  const current = currentArtifactCandidates(executions);
  const prepared = [];
  for (const name of names) {
    const output = current.get(name);
    const bytes =
      output === undefined
        ? await readWorkspaceFile?.(name)
        : Buffer.from(output.bytesBase64, "base64");
    if (bytes === undefined || bytes.byteLength > 8 * 1024 * 1024) continue;
    if (output !== undefined && bytes.toString("base64") !== output.bytesBase64) {
      throw new Error("agent_artifact_invalid");
    }
    prepared.push({
      name,
      mediaType: attachmentMediaType(name),
      byteLength: bytes.byteLength,
      contentHash: await artifacts.put(bytes),
    });
  }
  return prepared;
}

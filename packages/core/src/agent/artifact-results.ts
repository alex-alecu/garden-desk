import type { AgentArtifactSummary, AgentExecutionResult } from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { attachmentMediaType } from "./records.js";

export interface ArtifactOutput {
  name: string;
  bytesBase64: string;
}

function internal(path: string): boolean {
  return (
    path.startsWith(".vault-tools/") ||
    path.startsWith(".vault-output/") ||
    /(?:^|\/)checkpoints?\.json$/iu.test(path)
  );
}

export function currentArtifactOutputs(
  executions: readonly AgentExecutionResult[],
): ReadonlyMap<string, ArtifactOutput> {
  const current = new Map<string, ArtifactOutput>();
  for (const execution of executions) {
    for (const path of execution.invalidatedArtifactPaths ?? []) current.delete(path);
    for (const artifact of execution.artifacts) {
      if (!internal(artifact.name)) {
        current.set(artifact.name, {
          name: artifact.name,
          bytesBase64: artifact.bytesBase64,
        });
      }
    }
  }
  return current;
}

export function artifactCandidateNames(executions: readonly AgentExecutionResult[]): string[] {
  return [...currentArtifactOutputs(executions).keys()];
}

export async function prepareArtifacts(
  names: readonly string[],
  executions: readonly AgentExecutionResult[],
  artifacts: ArtifactStore,
): Promise<Array<Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">>> {
  const current = currentArtifactOutputs(executions);
  const prepared = [];
  for (const name of names) {
    const output = current.get(name);
    if (output === undefined) continue;
    const bytes = Buffer.from(output.bytesBase64, "base64");
    if (bytes.toString("base64") !== output.bytesBase64) {
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

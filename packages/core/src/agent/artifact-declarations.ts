import type { AgentArtifactSummary, AgentExecutionResult } from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { attachmentMediaType } from "./records.js";

export interface DeclaredArtifactOutput {
  name: string;
  bytesBase64: string;
}

export function currentArtifactOutputs(
  executions: readonly AgentExecutionResult[],
): ReadonlyMap<string, DeclaredArtifactOutput> {
  const current = new Map<string, DeclaredArtifactOutput>();
  for (const execution of executions) {
    for (const path of execution.invalidatedArtifactPaths ?? []) current.delete(path);
    for (const artifact of execution.artifacts) {
      current.set(artifact.name, { name: artifact.name, bytesBase64: artifact.bytesBase64 });
    }
  }
  return current;
}

export function artifactCandidateNames(executions: readonly AgentExecutionResult[]): string[] {
  return [...currentArtifactOutputs(executions).keys()];
}

export function declaredArtifactOutputs(
  declarations: readonly string[],
  executions: readonly AgentExecutionResult[],
): DeclaredArtifactOutput[] {
  const current = currentArtifactOutputs(executions);
  return declarations.flatMap((path) => {
    const output = current.get(path);
    return output === undefined ? [] : [output];
  });
}

export async function prepareDeclaredArtifacts(
  declarations: readonly string[],
  executions: readonly AgentExecutionResult[],
  artifacts: ArtifactStore,
): Promise<Array<Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">>> {
  const prepared = [];
  for (const output of declaredArtifactOutputs(declarations, executions)) {
    const bytes = Buffer.from(output.bytesBase64, "base64");
    if (bytes.toString("base64") !== output.bytesBase64) {
      throw new Error("agent_artifact_invalid");
    }
    prepared.push({
      name: output.name,
      mediaType: attachmentMediaType(output.name),
      byteLength: bytes.byteLength,
      contentHash: await artifacts.put(bytes),
    });
  }
  return prepared;
}

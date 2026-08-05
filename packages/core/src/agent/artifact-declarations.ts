import type { AgentArtifactSummary, AgentExecutionResult } from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { attachmentMediaType } from "./records.js";

export interface DeclaredArtifactOutput {
  name: string;
  bytesBase64: string;
}

function applyExecutionArtifacts(
  current: Map<string, DeclaredArtifactOutput>,
  execution: AgentExecutionResult,
): void {
  for (const path of execution.invalidatedArtifactPaths ?? []) current.delete(path);
  const produced = new Set(execution.artifacts.map((artifact) => artifact.name));
  const program = execution.command ?? execution.source ?? "";
  for (const path of current.keys()) {
    if (!produced.has(path) && !program.includes(path)) current.delete(path);
  }
  for (const artifact of execution.artifacts) {
    if (!isInternalArtifactPath(artifact.name)) {
      current.set(artifact.name, { name: artifact.name, bytesBase64: artifact.bytesBase64 });
    }
  }
}

export function isInternalArtifactPath(path: string): boolean {
  return /(?:^|\/)checkpoints?\.json$/iu.test(path);
}

export function currentArtifactOutputs(
  executions: readonly AgentExecutionResult[],
): ReadonlyMap<string, DeclaredArtifactOutput> {
  const current = new Map<string, DeclaredArtifactOutput>();
  for (const execution of executions) applyExecutionArtifacts(current, execution);
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

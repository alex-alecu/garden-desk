import {
  type AgentArtifactSummary,
  type AgentExecutionResult,
  AgentWorkspacePathSchema,
} from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { isSuccessfulExecution } from "./execution-success.js";
import { attachmentMediaType } from "./records.js";

export interface ArtifactOutput {
  name: string;
  bytesBase64: string;
}

export function isUserArtifactPath(path: string): boolean {
  return (
    AgentWorkspacePathSchema.safeParse(path).success &&
    !(
      path === ".vault-tools" ||
      path.startsWith(".vault-tools/") ||
      path === ".vault-output" ||
      path.startsWith(".vault-output/") ||
      /(?:^|\/)checkpoints?\.json$/iu.test(path)
    )
  );
}

function applyExecutionArtifacts(
  current: Map<string, ArtifactOutput>,
  execution: AgentExecutionResult,
): void {
  for (const path of execution.invalidatedArtifactPaths ?? []) current.delete(path);
  if (!isSuccessfulExecution(execution)) return;
  for (const artifact of execution.artifacts) {
    if (isUserArtifactPath(artifact.name)) {
      current.set(artifact.name, {
        name: artifact.name,
        bytesBase64: artifact.bytesBase64,
      });
    }
  }
}

export function currentArtifactOutputs(
  executions: readonly AgentExecutionResult[],
): ReadonlyMap<string, ArtifactOutput> {
  const current = new Map<string, ArtifactOutput>();
  for (const execution of executions) applyExecutionArtifacts(current, execution);
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

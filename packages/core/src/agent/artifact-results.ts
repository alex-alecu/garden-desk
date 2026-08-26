import {
  type AgentArtifactSummary,
  type AgentExecutionResult,
  AgentWorkspacePathSchema,
} from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { isSuccessfulExecution } from "./execution-success.js";
import { attachmentMediaType } from "./records.js";

const MAX_CURRENT_ARTIFACTS = 16;

export interface ArtifactOutput {
  name: string;
  bytesBase64: string;
}

interface ArtifactCandidate {
  name: string;
  bytesBase64?: string;
}

export function isUserArtifactPath(path: string): boolean {
  return (
    AgentWorkspacePathSchema.safeParse(path).success &&
    !(
      path.startsWith("steps/") ||
      path === ".vault-tools" ||
      path.startsWith(".vault-tools/") ||
      path === ".vault-output" ||
      path.startsWith(".vault-output/") ||
      /(?:^|\/)checkpoints?\.json$/iu.test(path)
    )
  );
}

function applyExecutionArtifacts(
  current: Map<string, ArtifactCandidate>,
  pending: Map<string, ArtifactCandidate>,
  execution: AgentExecutionResult,
): void {
  const invalidated = new Set(execution.invalidatedArtifactPaths ?? []);
  for (const path of invalidated) {
    current.delete(path);
    pending.delete(path);
  }
  if (!isSuccessfulExecution(execution)) {
    retainFailedArtifacts(current, pending, execution, invalidated);
    return;
  }
  publishSuccessfulArtifacts(current, pending, execution);
  for (const path of execution.recoverableArtifactPaths ?? []) {
    if (isUserArtifactPath(path)) pending.set(path, { name: path });
  }
}

function retainFailedArtifacts(
  current: Map<string, ArtifactCandidate>,
  pending: Map<string, ArtifactCandidate>,
  execution: AgentExecutionResult,
  invalidated: ReadonlySet<string>,
): void {
  for (const path of execution.recoverableArtifactPaths ?? []) {
    if (isUserArtifactPath(path)) pending.set(path, { name: path });
  }
  for (const artifact of execution.artifacts) {
    if (!invalidated.has(artifact.name) || !isUserArtifactPath(artifact.name)) continue;
    current.delete(artifact.name);
    pending.set(artifact.name, { name: artifact.name, bytesBase64: artifact.bytesBase64 });
  }
}

function publishSuccessfulArtifacts(
  current: Map<string, ArtifactCandidate>,
  pending: Map<string, ArtifactCandidate>,
  execution: AgentExecutionResult,
): void {
  for (const [name, output] of pending) {
    current.delete(name);
    current.set(name, output);
  }
  pending.clear();
  for (const artifact of execution.artifacts) {
    if (isUserArtifactPath(artifact.name)) {
      current.delete(artifact.name);
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
  const current = currentArtifactCandidates(executions);
  return new Map(
    [...current].flatMap(([name, output]) =>
      output.bytesBase64 === undefined
        ? []
        : [[name, { name, bytesBase64: output.bytesBase64 }] as const],
    ),
  );
}

function currentArtifactCandidates(
  executions: readonly AgentExecutionResult[],
): ReadonlyMap<string, ArtifactCandidate> {
  const current = new Map<string, ArtifactCandidate>();
  const pending = new Map<string, ArtifactCandidate>();
  for (const execution of executions) applyExecutionArtifacts(current, pending, execution);
  return current;
}

export function artifactCandidateNames(executions: readonly AgentExecutionResult[]): string[] {
  return [...currentArtifactCandidates(executions).keys()].slice(-MAX_CURRENT_ARTIFACTS);
}

export async function prepareArtifacts(
  names: readonly string[],
  executions: readonly AgentExecutionResult[],
  artifacts: ArtifactStore,
  readWorkspaceFile?: (path: string) => Promise<Buffer | undefined>,
): Promise<Array<Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">>> {
  const current = currentArtifactCandidates(executions);
  const prepared = [];
  for (const name of names) {
    const output = current.get(name);
    const bytes =
      output?.bytesBase64 === undefined
        ? await readWorkspaceFile?.(name)
        : Buffer.from(output.bytesBase64, "base64");
    if (bytes === undefined || bytes.byteLength > 8 * 1024 * 1024) continue;
    if (output?.bytesBase64 !== undefined && bytes.toString("base64") !== output.bytesBase64) {
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

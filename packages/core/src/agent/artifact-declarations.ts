import type { AgentArtifactSummary, AgentDecision, AgentExecutionResult } from "@vault/shared";
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

export function requestedArtifactNames(task: string): string[] {
  const requested =
    /\b(?:create|generate|make|produce|save|write)\b[^\n]{0,160}/giu.exec(task)?.[0] ?? "";
  return [
    ...new Set(
      Array.from(
        requested.matchAll(/(?:^|[\s"'`(])([^\s"'`()]+\.[A-Za-z0-9]{1,16})(?=$|[\s"'`),;])/gu),
        (match) => match[1] ?? "",
      ).filter((name) => name.length > 0),
    ),
  ];
}

export function requestedFactLabels(task: string): string[] {
  return [
    ...new Set(Array.from(task.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/gu), (match) => match[0])),
  ];
}

export function normalizeDeliverableFactRendering(
  decision: AgentDecision,
  task: string,
): AgentDecision {
  if (
    decision.action !== "execute" ||
    decision.language === "shell" ||
    requestedArtifactNames(task).length === 0
  ) {
    return decision;
  }
  const labels = requestedFactLabels(task);
  let source = decision.source.replaceAll(/\{label\}\s*:\s*\{value\}/gu, "{label}={value}");
  for (const label of labels) source = source.replaceAll(`${label}:`, `${label}=`);
  return { ...decision, source };
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

import type { AgentArtifactSummary, AgentDecision, AgentExecutionResult } from "@vault/shared";
import type { ArtifactStore } from "../workspace/artifacts.js";
import { attachmentMediaType } from "./records.js";

export interface DeclaredArtifactOutput {
  name: string;
  bytesBase64: string;
}

interface CurrentArtifactState {
  facts: ReadonlyMap<string, string>;
  output: DeclaredArtifactOutput;
}

function observedFacts(stdout: string, factLabels: readonly string[]): Map<string, string> {
  const facts = new Map<string, string>();
  const lines = stdout.split(/\r?\n/u).map((line) => line.trim());
  for (const label of factLabels) {
    const prefix = `${label}=`;
    const value = lines
      .filter((line) => line.startsWith(prefix))
      .at(-1)
      ?.slice(prefix.length);
    if (value !== undefined) facts.set(label, value);
  }
  return facts;
}

function staleArtifact(
  state: CurrentArtifactState,
  currentFacts: ReadonlyMap<string, string>,
): boolean {
  return [...currentFacts].some(([label, value]) => state.facts.get(label) !== value);
}

function applyExecutionArtifacts(
  current: Map<string, CurrentArtifactState>,
  currentFacts: Map<string, string>,
  execution: AgentExecutionResult,
  factLabels: readonly string[],
): void {
  for (const path of execution.invalidatedArtifactPaths ?? []) current.delete(path);
  for (const [label, value] of observedFacts(execution.stdout, factLabels)) {
    currentFacts.set(label, value);
  }
  for (const [path, state] of current) {
    if (staleArtifact(state, currentFacts)) current.delete(path);
  }
  for (const artifact of execution.artifacts) {
    if (!isInternalArtifactPath(artifact.name)) {
      current.set(artifact.name, {
        facts: new Map(currentFacts),
        output: { name: artifact.name, bytesBase64: artifact.bytesBase64 },
      });
    }
  }
}

export function isInternalArtifactPath(path: string): boolean {
  return /(?:^|\/)checkpoints?\.json$/iu.test(path);
}

export function currentArtifactOutputs(
  executions: readonly AgentExecutionResult[],
  factLabels: readonly string[] = [],
): ReadonlyMap<string, DeclaredArtifactOutput> {
  const current = new Map<string, CurrentArtifactState>();
  const facts = new Map<string, string>();
  for (const execution of executions)
    applyExecutionArtifacts(current, facts, execution, factLabels);
  return new Map([...current].map(([path, state]) => [path, state.output]));
}

export function artifactCandidateNames(
  executions: readonly AgentExecutionResult[],
  factLabels: readonly string[] = [],
): string[] {
  return [...currentArtifactOutputs(executions, factLabels).keys()];
}

export function requestedArtifactNames(task: string): string[] {
  const explicit = Array.from(
    task.matchAll(
      /\b(?:as|into|named)\s+([A-Za-z0-9][^\s"'`()]*\.[A-Za-z0-9]{1,16})(?=$|[\s"'`),;.])/giu,
    ),
    (match) => match[1] ?? "",
  ).filter((name) => name.length > 0);
  if (explicit.length > 0) return [...new Set(explicit)];
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
  factLabels: readonly string[] = [],
): DeclaredArtifactOutput[] {
  const current = currentArtifactOutputs(executions, factLabels);
  return declarations.flatMap((path) => {
    const output = current.get(path);
    return output === undefined ? [] : [output];
  });
}

export async function prepareDeclaredArtifacts(
  declarations: readonly string[],
  executions: readonly AgentExecutionResult[],
  artifacts: ArtifactStore,
  factLabels: readonly string[] = [],
): Promise<Array<Omit<AgentArtifactSummary, "id" | "runId" | "createdAt">>> {
  const prepared = [];
  for (const output of declaredArtifactOutputs(declarations, executions, factLabels)) {
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

import type { AgentRunSnapshot, AgentTrace } from "@vault/shared";
import type { ExpectedTableRow } from "./document-workloads.js";
import { legacyDocEvidence } from "./legacy-doc-evidence.js";
import {
  contextCompactionCount,
  evidenceClassification,
  inferenceFailureCount,
  productEvidenceReference,
  qualityCandidate,
  resultError,
} from "./m3-evidence-classification.js";
import type { ActiveCase, StressCaseResult } from "./m3-stress-runtime.js";
export function terminal(snapshot: AgentRunSnapshot): boolean {
  return snapshot.run.state !== "queued" && snapshot.run.state !== "running";
}
function reportProgress(active: ActiveCase, snapshot: AgentRunSnapshot): void {
  const latest = snapshot.events.at(-1);
  console.log(
    JSON.stringify({
      phase: "case.progress",
      id: active.fixture.id,
      runId: active.runId,
      state: snapshot.run.state,
      elapsedMs: Math.round(performance.now() - active.startedAt),
      executions: snapshot.executions.length,
      latestEvent: latest?.type ?? null,
      summary: latest?.summary ?? "Waiting for the first run event.",
    }),
  );
}
export function createProgressReporter() {
  const reportedAt = new Map<string, number>();
  const signatures = new Map<string, string>();
  return (active: ActiveCase, snapshot: AgentRunSnapshot): void => {
    const now = performance.now();
    const signature = [
      snapshot.run.state,
      snapshot.executions.length,
      snapshot.events.at(-1)?.id ?? "none",
    ].join(":");
    const changed = signatures.get(active.runId) !== signature;
    const heartbeatDue = !terminal(snapshot) && now - (reportedAt.get(active.runId) ?? 0) >= 15_000;
    if (!changed && !heartbeatDue) return;
    reportProgress(active, snapshot);
    signatures.set(active.runId, signature);
    reportedAt.set(active.runId, now);
  };
}
function outputHasToken(output: string, token: string): boolean {
  if (!token.includes("=")) {
    return output.toLocaleLowerCase("en-US").includes(token.toLocaleLowerCase("en-US"));
  }
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}(?:\\.0+)?[\\t ]*(?:$|\\n)`, "u").test(output);
}

function measuredRunMs(active: ActiveCase, snapshot: AgentRunSnapshot): number {
  return Math.max(
    Date.parse(snapshot.run.updatedAt) - Date.parse(snapshot.run.createdAt),
    Math.round(performance.now() - active.startedAt),
  );
}

function gfmTableRows(response: string): string[][] {
  return response
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter(
      (cells) =>
        cells.length >= 2 &&
        !cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replaceAll(/[\t ]/gu, ""))),
    );
}

function amountPattern(amount: number): RegExp {
  const digits = String(amount);
  const leading = digits.slice(0, digits.length % 3 || 3);
  const groups = digits.slice(leading.length).match(/.{3}/gu) ?? [];
  const formatted = [leading, ...groups].map((part) =>
    part.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  );
  return new RegExp(`(?<!\\d)${formatted.join("[\\s,.]?")}(?:[,.]0+)?(?!\\d)`, "u");
}

function missingTableRows(response: string, expected: ExpectedTableRow[]): ExpectedTableRow[] {
  const rows = gfmTableRows(response);
  return expected.filter(
    ({ marker, amount }) =>
      !rows.some(
        (cells) =>
          (marker === undefined || cells.some((cell) => cell.includes(marker))) &&
          cells.some((cell) => amountPattern(amount).test(cell)),
      ),
  );
}

function executionMetrics(active: ActiveCase, snapshot: AgentRunSnapshot) {
  const runs = [...active.previousSnapshots, snapshot];
  const allExecutions = runs.flatMap((run) => run.executions);
  return {
    executions: allExecutions.length,
    failedExecutions: allExecutions.filter((execution) => execution.state === "failed").length,
    executionMs: runs.reduce(
      (runTotal, run) =>
        runTotal +
        run.executions.reduce((total, execution) => total + (execution.durationMs ?? 0), 0),
      0,
    ),
  };
}

function toolCalls(response: unknown): unknown[] {
  if (typeof response !== "object" || response === null) return [];
  const calls = (response as { toolCalls?: unknown }).toolCalls;
  return Array.isArray(calls) ? calls : [];
}

function skillName(call: unknown): string | undefined {
  if (typeof call !== "object" || call === null) return undefined;
  const tool = call as { name?: unknown; params?: unknown };
  if (tool.name !== "skill" || typeof tool.params !== "object" || tool.params === null)
    return undefined;
  const name = (tool.params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

function calledSkillNames(trace: AgentTrace | undefined): string[] {
  if (trace?.captureVersion !== 1) return [];
  return trace.turns
    .flatMap((turn) => toolCalls(turn.structuredResponse).map(skillName))
    .filter((name): name is string => name !== undefined);
}

function firstLoadedSkills(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function sequenceIsOrdered(actual: string[], expected: string[]): boolean {
  let previous = -1;
  for (const name of expected) {
    const index = actual.indexOf(name);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

function skillEvidence(active: ActiveCase, trace: AgentTrace | undefined) {
  const requiredSkills = active.fixture.requiredSkills ?? [];
  const requiredSkillSequence = active.fixture.requiredSkillSequence ?? [];
  const forbiddenSkills = active.fixture.forbiddenSkills ?? [];
  const called = calledSkillNames(trace);
  const skills = new Set(called);
  const firstLoaded = firstLoadedSkills(called);
  return {
    requiredSkills,
    missingSkills: requiredSkills.filter((name) => !skills.has(name)),
    requiredSkillSequence,
    firstLoadedSkills: firstLoaded,
    skillOrderValid: sequenceIsOrdered(firstLoaded, requiredSkillSequence),
    forbiddenSkills,
    calledForbiddenSkills: forbiddenSkills.filter((name) => skills.has(name)),
  };
}

function executionTextEvidence(active: ActiveCase, snapshot: AgentRunSnapshot) {
  const requiredExecutionText = active.fixture.requiredExecutionText ?? [];
  const executions = [...active.previousSnapshots, snapshot]
    .flatMap((run) => run.executions)
    .filter(({ exitCode, state }) => state === "completed" && exitCode === 0);
  const text = executions
    .map(({ command, source }) => `${command ?? ""}\n${source ?? ""}`)
    .join("\n");
  return {
    requiredExecutionText,
    missingExecutionText: requiredExecutionText.filter((value) => !text.includes(value)),
  };
}

function responseEvidence(active: ActiveCase, snapshot: AgentRunSnapshot) {
  const output = snapshot.run.response ?? "";
  const forbiddenResponseText = active.fixture.forbiddenResponseText ?? [];
  const forbiddenResponsePatterns = active.fixture.forbiddenResponsePatterns ?? [];
  return {
    missingTokens: active.fixture.expectedTokens.filter((token) => !outputHasToken(output, token)),
    missingTableRows: missingTableRows(output, active.fixture.expectedTableRows ?? []),
    forbiddenResponseText,
    presentForbiddenResponseText: forbiddenResponseText.filter((text) =>
      output.toLocaleLowerCase("en-US").includes(text.toLocaleLowerCase("en-US")),
    ),
    forbiddenResponsePatterns,
    presentForbiddenResponsePatterns: forbiddenResponsePatterns.filter((pattern) =>
      new RegExp(pattern, "iu").test(output),
    ),
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one result keeps all acceptance gates visible.
export function stressResultFor(
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
  verification: {
    output?: string;
    retained?: string[];
    trace?: AgentTrace;
    verified?: string[];
  } = {},
): StressCaseResult {
  const verifiedDeliverables = verification.verified ?? [];
  const verificationOutput = verification.output ?? "";
  const response = responseEvidence(active, snapshot);
  const skills = skillEvidence(active, verification.trace);
  const executionText = executionTextEvidence(active, snapshot);
  const legacyDoc = legacyDocEvidence(active.fixture.id, snapshot, verification.trace);
  const errorEvidence = resultError(
    active.fixture.forbidArtifacts,
    snapshot.artifacts.length,
    snapshot.run.error,
  );
  const { artifactViolation, error } = errorEvidence;
  const metrics = executionMetrics(active, snapshot);
  const inferenceFailures = inferenceFailureCount(verification.trace);
  const quality = qualityCandidate(error, inferenceFailures);
  const expectedDeliverables = active.fixture.deliverables?.length ?? 0;
  const passed =
    snapshot.run.state === "succeeded" &&
    response.missingTokens.length === 0 &&
    response.missingTableRows.length === 0 &&
    response.presentForbiddenResponseText.length === 0 &&
    response.presentForbiddenResponsePatterns.length === 0 &&
    skills.missingSkills.length === 0 &&
    skills.skillOrderValid &&
    skills.calledForbiddenSkills.length === 0 &&
    executionText.missingExecutionText.length === 0 &&
    legacyDoc.orderValid &&
    legacyDoc.methodValid &&
    verifiedDeliverables.length === expectedDeliverables &&
    error === null;
  const productReference = productEvidenceReference({
    ...response,
    ...executionText,
    ...skills,
    legacyDocMethodValid: legacyDoc.methodValid,
    legacyDocOrderValid: legacyDoc.orderValid,
    artifactViolation,
    error,
    verifiedDeliverables,
    expectedDeliverables,
  });
  const classification = evidenceClassification({
    error,
    inferenceFailures,
    passed,
    productEvidenceReference: productReference,
    productFailure: artifactViolation,
    qualityCandidate: quality,
    state: snapshot.run.state,
  });
  return {
    id: active.fixture.id,
    passed,
    ...classification,
    ...(active.fixture.id === "legacy-doc-read" && legacyDoc.methodValid
      ? { repairMethod: "approved_legacy_doc_extraction" as const }
      : {}),
    fixtureMs: active.fixture.fixtureMs,
    fixtureBytes: active.fixture.evidence.bytes,
    fixtureFiles: active.fixture.evidence.files,
    runMs: measuredRunMs(active, snapshot),
    state: snapshot.run.state,
    ...metrics,
    expectedTokens: active.fixture.expectedTokens,
    ...response,
    ...executionText,
    ...skills,
    legacyDocMethodValid: legacyDoc.methodValid,
    legacyDocOrderValid: legacyDoc.orderValid,
    producedArtifacts: snapshot.artifacts.map((artifact) => artifact.name),
    error,
    inferenceFailures,
    qualityCandidate: quality,
    retainedArtifacts: verification.retained ?? [],
    verifiedDeliverables,
    verificationOutput,
    contextCompactions: contextCompactionCount(verification.trace),
  };
}

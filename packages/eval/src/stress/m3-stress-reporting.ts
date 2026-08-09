import type { AgentRunSnapshot, AgentTrace } from "@vault/shared";
import type { ActiveCase, StressCaseResult } from "./m3-stress-runtime.js";

export function terminal(snapshot: AgentRunSnapshot): boolean {
  return snapshot.run.state !== "queued" && snapshot.run.state !== "running";
}

function progressSignature(snapshot: AgentRunSnapshot): string {
  const latest = snapshot.events.at(-1);
  return [snapshot.run.state, snapshot.executions.length, latest?.id ?? "none"].join(":");
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
    const signature = progressSignature(snapshot);
    const changed = signatures.get(active.runId) !== signature;
    const heartbeatDue = !terminal(snapshot) && now - (reportedAt.get(active.runId) ?? 0) >= 15_000;
    if (!changed && !heartbeatDue) return;
    reportProgress(active, snapshot);
    signatures.set(active.runId, signature);
    reportedAt.set(active.runId, now);
  };
}

function snapshotOutput(snapshot: AgentRunSnapshot): string {
  return [
    snapshot.run.response ?? "",
    ...snapshot.executions.map((execution) => execution.stdout),
    ...snapshot.executions.map((execution) => execution.stderr),
  ].join("\n");
}

function outputHasToken(output: string, token: string): boolean {
  const escaped = token.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|\\n)${escaped}(?:\\.0+)?[\\t ]*(?:$|\\n)`, "u").test(output);
}

function measuredRunMs(active: ActiveCase, snapshot: AgentRunSnapshot): number {
  return Math.max(
    Date.parse(snapshot.run.updatedAt) - Date.parse(snapshot.run.createdAt),
    Math.round(performance.now() - active.startedAt),
  );
}

function contextCompactions(trace: AgentTrace | undefined): number {
  if (trace?.captureVersion !== 1) return 0;
  return trace.turns.filter((turn) => turn.prompt.includes("# Compacted task state")).length;
}

function stressError(
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
  compactions: number,
): string | null {
  if (
    active.fixture.maxExecutions !== undefined &&
    snapshot.executions.length > active.fixture.maxExecutions
  ) {
    return `Expected at most ${active.fixture.maxExecutions} executions.`;
  }
  if (active.fixture.forbidArtifacts === true && snapshot.artifacts.length > 0) {
    return "Expected no artifacts.";
  }
  const requiredCompactions =
    active.fixture.minimumContextCompactions ??
    (active.fixture.requiresContextCompaction === true ? 1 : 0);
  if (compactions < requiredCompactions) {
    return `Expected at least ${requiredCompactions} automatic context compaction event${requiredCompactions === 1 ? "" : "s"}.`;
  }
  return snapshot.run.error;
}

export function stressResultFor(
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
  verification: {
    output?: string;
    trace?: AgentTrace;
    verified?: string[];
  } = {},
): StressCaseResult {
  const verifiedDeliverables = verification.verified ?? [];
  const verificationOutput = verification.output ?? "";
  const output = snapshotOutput(snapshot);
  const missingTokens = active.fixture.expectedTokens.filter(
    (token) => !outputHasToken(output, token),
  );
  const compactions = contextCompactions(verification.trace);
  const error = stressError(active, snapshot, compactions);
  return {
    id: active.fixture.id,
    passed:
      snapshot.run.state === "succeeded" &&
      missingTokens.length === 0 &&
      verifiedDeliverables.length === (active.fixture.deliverables?.length ?? 0) &&
      error === null,
    fixtureMs: active.fixture.fixtureMs,
    fixtureBytes: active.fixture.evidence.bytes,
    fixtureFiles: active.fixture.evidence.files,
    runMs: measuredRunMs(active, snapshot),
    state: snapshot.run.state,
    executions: [...active.previousSnapshots, snapshot].reduce(
      (total, run) => total + run.executions.length,
      0,
    ),
    executionMs: [...active.previousSnapshots, snapshot].reduce(
      (runTotal, run) =>
        runTotal +
        run.executions.reduce((total, execution) => total + (execution.durationMs ?? 0), 0),
      0,
    ),
    expectedTokens: active.fixture.expectedTokens,
    missingTokens,
    producedArtifacts: snapshot.artifacts.map((artifact) => artifact.name),
    error,
    verifiedDeliverables,
    verificationOutput,
    contextCompactions: compactions,
  };
}

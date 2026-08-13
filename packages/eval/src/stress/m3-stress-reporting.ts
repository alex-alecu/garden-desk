import type { AgentRunSnapshot, AgentTrace } from "@vault/shared";
import type { ExpectedTableRow } from "./document-workloads.js";
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

function inferenceFailures(trace: AgentTrace | undefined): number {
  if (trace?.captureVersion !== 1) return 0;
  return trace.turns.filter((turn) => turn.outcome === "inference_failed").length;
}

function contextCompactions(trace: AgentTrace | undefined): number {
  if (trace?.captureVersion !== 1) return 0;
  return trace.turns.filter((turn) => turn.prompt.includes("# Compacted task state")).length;
}

function stressError(active: ActiveCase, snapshot: AgentRunSnapshot): string | null {
  if (active.fixture.forbidArtifacts === true && snapshot.artifacts.length > 0) {
    return "Expected no artifacts.";
  }
  return snapshot.run.error;
}

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
  const output = snapshot.run.response ?? "";
  const missingTokens = active.fixture.expectedTokens.filter(
    (token) => !outputHasToken(output, token),
  );
  const missingRows = missingTableRows(
    snapshot.run.response ?? "",
    active.fixture.expectedTableRows ?? [],
  );
  const compactions = contextCompactions(verification.trace);
  const error = stressError(active, snapshot);
  const passed =
    snapshot.run.state === "succeeded" &&
    missingTokens.length === 0 &&
    missingRows.length === 0 &&
    verifiedDeliverables.length === (active.fixture.deliverables?.length ?? 0) &&
    error === null;
  return {
    id: active.fixture.id,
    passed,
    fixtureMs: active.fixture.fixtureMs,
    fixtureBytes: active.fixture.evidence.bytes,
    fixtureFiles: active.fixture.evidence.files,
    runMs: measuredRunMs(active, snapshot),
    state: snapshot.run.state,
    ...executionMetrics(active, snapshot),
    expectedTokens: active.fixture.expectedTokens,
    missingTokens,
    missingTableRows: missingRows,
    producedArtifacts: snapshot.artifacts.map((artifact) => artifact.name),
    error,
    inferenceFailures: inferenceFailures(verification.trace),
    retainedArtifacts: verification.retained ?? [],
    verifiedDeliverables,
    verificationOutput,
    contextCompactions: compactions,
  };
}

import type { AgentExecutionSnapshot, AgentRunSnapshot, AgentTrace } from "@vault/shared";
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

function snapshotOutput(snapshot: AgentRunSnapshot): string {
  return [
    snapshot.run.response ?? "",
    ...snapshot.executions.map((execution) => execution.stdout),
    ...snapshot.executions.map((execution) => execution.stderr),
  ].join("\n");
}

function executions(active: ActiveCase, snapshot: AgentRunSnapshot): AgentExecutionSnapshot[] {
  return [...active.previousSnapshots, snapshot].flatMap((run) => run.executions);
}

function expectedOutput(active: ActiveCase, snapshot: AgentRunSnapshot): string {
  if (active.fixture.requiresDirectXlsxSource !== true) return snapshotOutput(snapshot);
  return executions(active, snapshot)
    .map((execution) => execution.stdout)
    .join("\n");
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
          cells.some((cell) => cell.includes(marker)) &&
          cells.some((cell) => amountPattern(amount).test(cell)),
      ),
  );
}

function schemaUsesSourceOnly(schema: Record<string, unknown>): boolean {
  const properties = schema.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    return false;
  }
  return Object.hasOwn(properties, "source") && !Object.hasOwn(properties, "command");
}

function initialTraceErrors(trace: AgentTrace | undefined): string[] {
  const firstTurn = trace?.captureVersion === 1 ? trace.turns[0] : undefined;
  if (firstTurn === undefined) return ["Expected a recorded initial inference trace."];
  const errors: string[] = [];
  if (!firstTurn.prompt.includes("## Active skill: xlsx-workbooks")) {
    errors.push("Expected active XLSX guidance in the first trace prompt.");
  }
  if (!schemaUsesSourceOnly(firstTurn.jsonSchema)) {
    errors.push("Expected a source-only first trace schema.");
  }
  return errors;
}

function directXlsxTraceError(
  active: ActiveCase,
  snapshot: AgentRunSnapshot,
  trace: AgentTrace | undefined,
): string | null {
  if (active.fixture.requiresDirectXlsxSource !== true) return null;
  const errors = initialTraceErrors(trace);
  const allExecutions = executions(active, snapshot);
  if (allExecutions[0]?.language !== "python") {
    errors.push("Expected Python as the first execution.");
  }
  if (allExecutions.some((execution) => execution.language === "shell")) {
    errors.push("Expected no shell execution.");
  }
  return errors.length === 0 ? null : errors.join(" ");
}

function executionMetrics(active: ActiveCase, snapshot: AgentRunSnapshot) {
  const runs = [...active.previousSnapshots, snapshot];
  return {
    executions: runs.reduce((total, run) => total + run.executions.length, 0),
    executionMs: runs.reduce(
      (runTotal, run) =>
        runTotal +
        run.executions.reduce((total, execution) => total + (execution.durationMs ?? 0), 0),
      0,
    ),
  };
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
    executions(active, snapshot).length > active.fixture.maxExecutions
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
  const output = expectedOutput(active, snapshot);
  const missingTokens = active.fixture.expectedTokens.filter(
    (token) => !outputHasToken(output, token),
  );
  const missingRows = missingTableRows(
    snapshot.run.response ?? "",
    active.fixture.expectedTableRows ?? [],
  );
  const compactions = contextCompactions(verification.trace);
  const error = stressError(active, snapshot, compactions);
  const traceError = directXlsxTraceError(active, snapshot, verification.trace);
  const passed =
    snapshot.run.state === "succeeded" &&
    missingTokens.length === 0 &&
    missingRows.length === 0 &&
    verifiedDeliverables.length === (active.fixture.deliverables?.length ?? 0) &&
    error === null &&
    traceError === null;
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
    traceError,
    verifiedDeliverables,
    verificationOutput,
    contextCompactions: compactions,
  };
}

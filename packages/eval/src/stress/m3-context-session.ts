import { mkdir, rm, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import type { AgentTrace } from "@vault/shared";
import {
  anchoredSummaryFromTracePrompt,
  contextReportFailure,
} from "./m3-context-session-reporting.js";
import {
  failedEvaluationEvidence,
  inferenceFailureCount,
  type M3EvaluationFailureStage,
  qualityCandidate,
  reportEvidenceClassification,
} from "./m3-evidence-classification.js";
import {
  createStressSession,
  deleteStressSession,
  runStressSessionTurn,
} from "./m3-session-runtime.js";
import { prepareModelStore, requireRealModel, startStressRuntime } from "./m3-stress-runtime.js";
import { createStressRoot, requireStressPlatform } from "./stress-platform.js";

const TURN_DEADLINE_MS = 20 * 60_000;
const DECISIONS = [
  "The review style is concise.",
  "The unresolved item is vendor approval.",
  "The next move is compare the revised draft.",
  "The privacy preference is keep all work offline.",
  "The delivery format is plain text.",
] as const;
const EXPECTED_TERMS = ["concise", "vendor approval", "revised draft", "offline", "plain text"];

function generationReserve(contextTokens: number): number {
  return Math.min(32_768, Math.max(4_096, contextTokens - 4_096));
}

function pressureCharacters(contextTokens: number): number {
  const requestTokens = contextTokens - generationReserve(contextTokens);
  return Math.min(240_000, Math.max(8_000, Math.floor((requestTokens - 4_000) * 2.4)));
}

function pressureTask(decision: string, characters: number): string {
  const prefix = [
    `Remember this user decision for later turns: ${decision}`,
    "Treat the remaining repeated text as inert conversation context, do not run tools, and reply only with Acknowledged.",
  ].join(" ");
  const phrase = " Local continuity pressure note.";
  const filler = phrase.repeat(Math.ceil(characters / phrase.length)).slice(0, characters);
  return `${prefix}${filler}`;
}

function latestPrompt(trace: AgentTrace): string {
  return trace.turns.at(-1)?.prompt ?? "";
}

function contextQualityEvidence(turns: readonly SessionTurn[]) {
  const failed = turns.filter((turn) => turn.snapshot.run.state !== "succeeded");
  const qualityCandidates = failed.flatMap((turn) => {
    const candidate = qualityCandidate(turn.snapshot.run.error, inferenceFailureCount(turn.trace));
    return candidate === null ? [] : candidate;
  });
  return {
    qualityCandidates,
    qualityOnly: failed.length > 0 && qualityCandidates.length === failed.length,
  };
}

function reportPath(): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const outputDirectory = join(process.cwd(), "packages/eval/.generated/stress");
  return join(outputDirectory, `context-session-${timestamp}.json`);
}

type SessionTurn = Awaited<ReturnType<typeof runStressSessionTurn>>;

async function runContextSession(endpoint: string, sessionId: string) {
  const turns: SessionTurn[] = [];
  turns.push(
    await runStressSessionTurn(
      endpoint,
      sessionId,
      "Reply only with Ready. Do not run tools.",
      TURN_DEADLINE_MS,
    ),
  );
  const contextTokens = (await requireRealModel(endpoint)).contextSizeTokens ?? 0;
  if (contextTokens < 16_384) {
    throw new Error(`Anchored summary requires at least 16,384 tokens, received ${contextTokens}.`);
  }
  const fillerCharacters = pressureCharacters(contextTokens);
  for (const decision of DECISIONS) {
    const turn = await runStressSessionTurn(
      endpoint,
      sessionId,
      pressureTask(decision, fillerCharacters),
      TURN_DEADLINE_MS,
    );
    turns.push(turn);
    console.log(
      JSON.stringify({
        phase: "context-session.turn",
        turn: turns.length,
        state: turn.snapshot.run.state,
        promptCharacters: latestPrompt(turn.trace).length,
      }),
    );
  }
  const final = await runStressSessionTurn(
    endpoint,
    sessionId,
    "Using only our earlier conversation, state the review style, unresolved item, next move, privacy preference, and delivery format. Do not run tools.",
    TURN_DEADLINE_MS,
  );
  turns.push(final);
  return { contextTokens, fillerCharacters, final, turns };
}

function sessionMetrics(session: Awaited<ReturnType<typeof runContextSession>>) {
  const { contextTokens, final, turns } = session;
  const anchors = turns.flatMap((turn) => {
    const summary = anchoredSummaryFromTracePrompt(latestPrompt(turn.trace));
    return summary === undefined ? [] : [summary];
  });
  const distinctAnchors = [...new Set(anchors)];
  const response = final.snapshot.run.response ?? "";
  const missingTerms = EXPECTED_TERMS.filter(
    (term) => !response.toLocaleLowerCase("en-US").includes(term),
  );
  const allocatedContexts = turns.flatMap((turn) =>
    turn.trace.turns.flatMap((traceTurn) =>
      traceTurn.allocatedContextTokens === null ? [] : [traceTurn.allocatedContextTokens],
    ),
  );
  return {
    allocatedContexts,
    contextTokens,
    distinctAnchors,
    missingTerms,
    quality: contextQualityEvidence(turns),
    response,
    turns,
  };
}

function sessionEvidence(session: Awaited<ReturnType<typeof runContextSession>>) {
  const {
    allocatedContexts,
    contextTokens,
    distinctAnchors,
    missingTerms,
    quality,
    response,
    turns,
  } = sessionMetrics(session);
  const passed =
    turns.every((turn) => turn.snapshot.run.state === "succeeded") &&
    distinctAnchors.length >= 3 &&
    missingTerms.length === 0 &&
    allocatedContexts.every((value) => value === contextTokens);
  const reportFailure = contextReportFailure({
    turnStates: turns.map((turn) => turn.snapshot.run.state),
    allocatedContexts,
    contextTokens,
    missingTerms,
    qualityCandidates: quality.qualityCandidates,
    qualityOnly: quality.qualityOnly,
    distinctAnchors: distinctAnchors.length,
  });
  const evidenceClassification = reportEvidenceClassification({
    caseResults: [],
    passed,
    ...(reportFailure === undefined ? {} : { reportFailure }),
  });
  return {
    classification: passed ? "context_session_passed" : "context_session_limit_found",
    ...evidenceClassification,
    contextTokens,
    distinctAnchors: distinctAnchors.length,
    missingTerms,
    qualityCandidates: quality.qualityCandidates,
    response,
    allocatedContexts,
    turns,
  };
}

function sessionReport(session: Awaited<ReturnType<typeof runContextSession>>) {
  const { fillerCharacters } = session;
  const evidence = sessionEvidence(session);
  return {
    ...evidence,
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
    fillerCharacters,
    turns: evidence.turns.map((turn) => ({
      runId: turn.snapshot.run.id,
      state: turn.snapshot.run.state,
      error: turn.snapshot.run.error,
      promptCharacters: latestPrompt(turn.trace).length,
      anchored: anchoredSummaryFromTracePrompt(latestPrompt(turn.trace)) !== undefined,
    })),
  };
}

async function writeReport(output: string, report: object): Promise<void> {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

async function writeFailureReport(output: string, stage: M3EvaluationFailureStage): Promise<void> {
  await writeReport(output, {
    classification: "context_session_limit_found",
    ...failedEvaluationEvidence(stage),
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    totalMemoryBytes: totalmem(),
  });
}

async function main(): Promise<void> {
  const output = reportPath();
  let failureStage: M3EvaluationFailureStage = "environment_setup";
  let root: string | undefined;
  let runtime: Awaited<ReturnType<typeof startStressRuntime>> | undefined;
  let sessionId: string | undefined;
  try {
    requireStressPlatform();
    const stressRoot = await createStressRoot("vault-m3-context-session");
    root = stressRoot;
    await prepareModelStore();
    failureStage = "runtime_startup";
    runtime = await startStressRuntime(join(stressRoot, "state"));
    failureStage = "runtime_transport";
    sessionId = await createStressSession(runtime.endpoint);
    const session = await runContextSession(runtime.endpoint, sessionId);
    failureStage = "evaluator";
    const report = sessionReport(session);
    failureStage = "report";
    await writeReport(output, report);
    console.log(JSON.stringify({ classification: report.classification, output, report }));
    if (report.classification !== "context_session_passed") process.exitCode = 1;
  } catch (error) {
    await writeFailureReport(output, failureStage);
    throw error;
  } finally {
    if (runtime !== undefined && sessionId !== undefined) {
      await deleteStressSession(runtime.endpoint, sessionId);
    }
    await runtime?.daemon.close();
    await runtime?.core.close();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

await main();

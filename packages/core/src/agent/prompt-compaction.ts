import type { AgentExecutionResult } from "@vault/shared";
import { artifactCandidateNames } from "./artifact-declarations.js";
import type { PromptLibrary } from "./prompt-library.js";

const MAX_EVIDENCE_LINES = 24;
const MAX_EVIDENCE_LINE_CHARACTERS = 512;
const DEFAULT_LIVE_OBSERVATION_CHARACTERS = 32_000;

export function currentRunNeedsCompaction(executions: AgentExecutionResult[]): boolean {
  return (
    executions.reduce(
      (total, execution) => total + execution.stdout.length + execution.stderr.length,
      0,
    ) > DEFAULT_LIVE_OBSERVATION_CHARACTERS
  );
}

function normalizedTerms(task: string): Set<string> {
  return new Set(
    task
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((term) => term.length >= 5),
  );
}

function salience(line: string, terms: ReadonlySet<string>): number {
  const normalized = line.toLocaleLowerCase("en-US");
  const matchingTerms = [...terms].filter((term) => normalized.includes(term)).length;
  return matchingTerms + (/\b[A-Z][A-Z0-9_]{2,}=/u.test(line) ? 100 : 0);
}

function evidenceLines(task: string, executions: AgentExecutionResult[]): string[] {
  const terms = normalizedTerms(task);
  const lines = executions.flatMap((execution) =>
    `${execution.stdout}\n${execution.stderr}`.split(/\r?\n/u),
  );
  const candidates = lines
    .map((line, order) => ({ line: line.trim(), order }))
    .map((item) => ({ ...item, score: salience(item.line, terms) }))
    .filter((item) => item.line.length > 0 && item.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);
  return [
    ...new Set(candidates.map((item) => item.line.slice(0, MAX_EVIDENCE_LINE_CHARACTERS))),
  ].slice(0, MAX_EVIDENCE_LINES);
}

function executionLedger(executions: AgentExecutionResult[]) {
  return executions.map((execution, index) => ({
    step: index + 1,
    language: execution.language,
    path: execution.path,
    exitCode: execution.exitCode,
    termination: execution.termination,
    stdoutCharacters: execution.stdout.length,
    stderrCharacters: execution.stderr.length,
    artifacts: execution.artifacts.map((artifact) => artifact.name),
  }));
}

export function compactedTaskState(
  task: string,
  executions: AgentExecutionResult[],
  observationCharacters: number,
  library: PromptLibrary,
): string {
  const streamCharacters = executions.reduce(
    (total, execution) => total + execution.stdout.length + execution.stderr.length,
    0,
  );
  if (streamCharacters <= observationCharacters) return "";
  const failed = executions.filter(
    (execution) => execution.exitCode !== 0 || execution.termination !== "completed",
  );
  return library.state("context-compaction", {
    artifact_ledger: JSON.stringify(artifactCandidateNames(executions)),
    evidence_ledger: JSON.stringify(evidenceLines(task, executions)),
    execution_ledger: JSON.stringify(executionLedger(executions)),
    omitted_characters: Math.max(0, streamCharacters - observationCharacters).toLocaleString(
      "en-US",
    ),
    warning_ledger: JSON.stringify(
      failed.map((execution, index) => ({
        step: executions.indexOf(execution) + 1,
        exitCode: execution.exitCode,
        termination: execution.termination,
        stderr: execution.stderr.slice(0, MAX_EVIDENCE_LINE_CHARACTERS),
        failure: index + 1,
      })),
    ),
  });
}

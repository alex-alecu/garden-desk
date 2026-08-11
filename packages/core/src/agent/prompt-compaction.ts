import type { AgentExecutionResult } from "@vault/shared";
import { artifactCandidateNames, requestedFactLabels } from "./artifact-declarations.js";
import { MAX_AGENT_EXECUTIONS } from "./limits.js";
import {
  type AnchoredLedger,
  anchorIsCurrent,
  EMPTY_ANCHORED_LEDGER,
  mergeAnchoredLedger,
} from "./prompt-anchor.js";
import type { PromptLibrary } from "./prompt-library.js";
import { executionContextCharacters } from "./prompt-observations.js";

const MAX_EVIDENCE_LINES = 24;
const MAX_EVIDENCE_LINES_PER_EXECUTION = Math.floor(MAX_EVIDENCE_LINES / MAX_AGENT_EXECUTIONS);
const MAX_EVIDENCE_LINE_CHARACTERS = 512;
const DEFAULT_LIVE_OBSERVATION_CHARACTERS = 32_000;
const MAX_ANCHORED_WARNINGS = 8;

/**
 * Anchors one run's compacted ledger. Each prompt build merges only the executions the
 * anchor has not covered yet, so repeated builds stop rescanning the complete raw
 * stream set. The merge is deterministic, so an anchored ledger and a from-scratch
 * ledger describe the same executions.
 */
export class LedgerAnchor {
  private anchor: AnchoredLedger = EMPTY_ANCHORED_LEDGER;

  current(): AnchoredLedger {
    return this.anchor;
  }

  advance(task: string, executions: AgentExecutionResult[]): AnchoredLedger {
    if (anchorIsCurrent(this.anchor, executions)) return this.anchor;
    const pending = executions.slice(this.anchor.coveredExecutions);
    this.anchor = mergeAnchoredLedger(
      this.anchor,
      {
        evidence: evidenceLines(task, pending),
        artifacts: artifactCandidateNames(executions, requestedFactLabels(task)),
        warnings: warningLedger(executions, this.anchor.coveredExecutions),
      },
      executions.length,
      { evidence: MAX_EVIDENCE_LINES, warnings: MAX_ANCHORED_WARNINGS },
    );
    return this.anchor;
  }
}

function warningLedger(executions: AgentExecutionResult[], from: number) {
  return executions.slice(from).flatMap((execution, offset) => {
    const step = from + offset + 1;
    if (execution.exitCode === 0 && execution.termination === "completed") return [];
    return [
      {
        step,
        exitCode: execution.exitCode,
        termination: execution.termination,
        stderr: execution.stderr.slice(0, MAX_EVIDENCE_LINE_CHARACTERS),
      },
    ];
  });
}

export function currentRunNeedsCompaction(executions: AgentExecutionResult[]): boolean {
  return executionContextCharacters(executions) > DEFAULT_LIVE_OBSERVATION_CHARACTERS;
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
  const explicitIdentifier = /\b[A-Z][A-Z0-9_]{2,}\b/u.test(line) ? 100 : 0;
  const exactLabel = /\b[A-Z][A-Z0-9_]{2,}=/u.test(line) ? 100 : 0;
  return matchingTerms + explicitIdentifier + exactLabel;
}

function evidenceLines(task: string, executions: AgentExecutionResult[]): string[] {
  const terms = normalizedTerms(task);
  return executions.flatMap((execution) => {
    const lines = `${execution.stdout}\n${execution.stderr}`.split(/\r?\n/u);
    const candidates = lines
      .map((line, order) => ({ line: line.trim(), order }))
      .map((item) => ({ ...item, score: salience(item.line, terms) }))
      .filter((item) => item.line.length > 0 && item.score > 0)
      .sort((left, right) => right.score - left.score || left.order - right.order);
    return [
      ...new Set(candidates.map((item) => item.line.slice(0, MAX_EVIDENCE_LINE_CHARACTERS))),
    ].slice(0, MAX_EVIDENCE_LINES_PER_EXECUTION);
  });
}

function executionLedger(executions: AgentExecutionResult[]) {
  return executions.map((execution, index) => ({
    step: index + 1,
    language: execution.language,
    path: execution.path,
    exitCode: execution.exitCode,
    termination: execution.termination,
    sourceCharacters: execution.source?.length ?? 0,
    commandCharacters: execution.command?.length ?? 0,
    stdoutCharacters: execution.stdout.length,
    stderrCharacters: execution.stderr.length,
    artifacts: execution.artifacts.map((artifact) => artifact.name),
  }));
}

export interface CompactedTaskStateInput {
  task: string;
  executions: AgentExecutionResult[];
  observationCharacters: number;
  library: PromptLibrary;
  anchor?: LedgerAnchor | undefined;
}

export function compactedTaskState(input: CompactedTaskStateInput): string {
  const { task, executions, observationCharacters, library } = input;
  const streamCharacters = executionContextCharacters(executions);
  if (streamCharacters <= observationCharacters) return "";
  const ledger = (input.anchor ?? new LedgerAnchor()).advance(task, executions);
  return library.state("context-compaction", {
    artifact_ledger: JSON.stringify(ledger.artifacts),
    evidence_ledger: JSON.stringify(ledger.evidence),
    execution_ledger: JSON.stringify(executionLedger(executions)),
    omitted_characters: Math.max(0, streamCharacters - observationCharacters).toLocaleString(
      "en-US",
    ),
    warning_ledger: JSON.stringify(ledger.warnings),
  });
}

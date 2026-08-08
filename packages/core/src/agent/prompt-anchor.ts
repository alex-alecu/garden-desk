import type { AgentExecutionResult } from "@vault/shared";

/**
 * A deterministic anchored ledger. OpenCode anchors its model-written summary so a
 * long session accumulates one evolving document instead of re-deriving from scratch.
 * The same anchoring is worth having for our ledgers, and merging ledgers needs no
 * model: the merge is exact set and record union, so anchoring adds no drift.
 */
export interface AnchoredLedger {
  coveredExecutions: number;
  evidence: readonly string[];
  artifacts: readonly string[];
  warnings: readonly AnchoredWarning[];
}

export interface AnchoredWarning {
  step: number;
  exitCode: number;
  termination: string;
  stderr: string;
}

export const EMPTY_ANCHORED_LEDGER: AnchoredLedger = {
  coveredExecutions: 0,
  evidence: [],
  artifacts: [],
  warnings: [],
};

/**
 * Merges newly derived ledger content into the anchor. Evidence and artifacts are
 * ordered sets so a repeated observation never duplicates, and warnings are keyed by
 * their execution step so a repaired step reports once.
 */
export function mergeAnchoredLedger(
  anchor: AnchoredLedger,
  next: Omit<AnchoredLedger, "coveredExecutions">,
  coveredExecutions: number,
  limits: { evidence: number; warnings: number },
): AnchoredLedger {
  const warnings = new Map(anchor.warnings.map((warning) => [warning.step, warning]));
  for (const warning of next.warnings) warnings.set(warning.step, warning);
  return {
    coveredExecutions: Math.max(anchor.coveredExecutions, coveredExecutions),
    evidence: [...new Set([...anchor.evidence, ...next.evidence])].slice(-limits.evidence),
    artifacts: [...new Set([...anchor.artifacts, ...next.artifacts])],
    warnings: [...warnings.values()]
      .sort((left, right) => left.step - right.step)
      .slice(-limits.warnings),
  };
}

/**
 * Anchoring is only worth its bookkeeping once a run has produced more executions
 * than the anchor already covers.
 */
export function anchorIsCurrent(
  anchor: AnchoredLedger,
  executions: readonly AgentExecutionResult[],
): boolean {
  return anchor.coveredExecutions >= executions.length;
}

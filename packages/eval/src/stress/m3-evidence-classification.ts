import type { AgentTrace } from "@vault/shared";

export type M3FailureClass =
  | "passed"
  | "model_limit"
  | "product_failure"
  | "runtime_failure"
  | "environment_blocked"
  | "harness_failure";

type M3EvaluatorFailureClass = Exclude<M3FailureClass, "model_limit">;

export const M3_QUALITY_TERMINAL_CODES = [
  "agent_context_exhausted",
  "agent_decision_limit_exceeded",
  "agent_empty_response",
  "agent_generation_limit",
  "agent_stalled_duplicate",
  "agent_turn_limit_exceeded",
] as const;

export type M3QualityCandidate = (typeof M3_QUALITY_TERMINAL_CODES)[number];

export type M3EvidenceReference =
  | "result.missingTokens"
  | "result.missingTableRows"
  | "result.presentForbiddenResponseText"
  | "result.presentForbiddenResponsePatterns"
  | "result.missingSkills"
  | "result.skillOrderValid"
  | "result.calledForbiddenSkills"
  | "result.missingExecutionText"
  | "result.legacyDocMethodValid"
  | "result.legacyDocOrderValid"
  | "result.verifiedDeliverables"
  | "result.producedArtifacts"
  | "result.evaluator"
  | "trace.inferenceFailures"
  | "run.error"
  | "report.auditValid"
  | "report.modelAfterError"
  | "report.turns"
  | "report.missingTerms"
  | "report.distinctAnchors"
  | "report.allocatedContexts"
  | "report.maximumRunning"
  | "report.policyCases"
  | "report.qualityCandidates"
  | "report.failure";

export type M3EvaluationFailureStage =
  | "cli_input"
  | "fixture"
  | "evaluator"
  | "report"
  | "environment_setup"
  | "runtime_startup"
  | "runtime_transport"
  | "product_hard_check";

const FAILURE_CODES = {
  cli_input: "m3_cli_input_failure",
  fixture: "m3_fixture_failure",
  evaluator: "m3_evaluator_failure",
  report: "m3_report_failure",
  environment_setup: "m3_environment_setup_blocked",
  runtime_startup: "m3_runtime_startup_failure",
  runtime_transport: "m3_runtime_transport_failure",
  product_hard_check: "m3_product_hard_check_failure",
} as const satisfies Record<M3EvaluationFailureStage, string>;

export function failedEvaluationEvidence(stage: M3EvaluationFailureStage) {
  const failure = { code: FAILURE_CODES[stage], stage };
  switch (stage) {
    case "cli_input":
    case "fixture":
    case "evaluator":
    case "report":
      return {
        failureClass: "harness_failure" as const,
        evidenceReference: "report.failure" as const,
        failure,
      };
    case "environment_setup":
      return {
        failureClass: "environment_blocked" as const,
        evidenceReference: "report.failure" as const,
        failure,
      };
    case "runtime_startup":
    case "runtime_transport":
      return {
        failureClass: "runtime_failure" as const,
        evidenceReference: "report.failure" as const,
        failure,
      };
    case "product_hard_check":
      return {
        failureClass: "product_failure" as const,
        evidenceReference: "report.failure" as const,
        failure,
      };
  }
}

export function concurrentReportFailure(maximumRunning: number | null) {
  return maximumRunning === null || maximumRunning >= 3
    ? undefined
    : {
        failureClass: "product_failure" as const,
        evidenceReference: "report.maximumRunning" as const,
      };
}

export function qualityCandidate(
  error: string | null,
  inferenceFailures: number,
): M3QualityCandidate | null {
  if (error === null || inferenceFailures > 0) return null;
  return M3_QUALITY_TERMINAL_CODES.find((code) => code === error) ?? null;
}

export function reportQualityCandidates(
  results: ReadonlyArray<{ qualityCandidate: M3QualityCandidate | null }>,
): M3QualityCandidate[] {
  return results.flatMap((result) =>
    result.qualityCandidate === null ? [] : result.qualityCandidate,
  );
}

export function contextCompactionCount(trace: AgentTrace | undefined): number {
  return trace?.captureVersion === 1
    ? trace.turns.filter((turn) => turn.prompt.includes("<workspace-state>")).length
    : 0;
}

export function resultError(
  forbidArtifacts: boolean | undefined,
  artifactCount: number,
  runError: string | null,
): { artifactViolation: boolean; error: string | null } {
  const artifactViolation = forbidArtifacts === true && artifactCount > 0;
  return { artifactViolation, error: artifactViolation ? "Expected no artifacts." : runError };
}

export function inferenceFailureCount(trace: AgentTrace | undefined): number {
  return trace?.captureVersion === 1
    ? trace.turns.filter((turn) => turn.outcome === "inference_failed").length
    : 0;
}

interface ProductEvidence {
  artifactViolation: boolean;
  calledForbiddenSkills: string[];
  error: string | null;
  expectedDeliverables: number;
  legacyDocMethodValid: boolean;
  legacyDocOrderValid: boolean;
  missingExecutionText: string[];
  missingSkills: string[];
  missingTableRows: unknown[];
  missingTokens: string[];
  presentForbiddenResponsePatterns: string[];
  presentForbiddenResponseText: string[];
  skillOrderValid: boolean;
  verifiedDeliverables: string[];
}

export function productEvidenceReference(result: ProductEvidence): M3EvidenceReference {
  if (result.artifactViolation) return "result.producedArtifacts";
  const arrays: Array<[readonly unknown[], M3EvidenceReference]> = [
    [result.missingTokens, "result.missingTokens"],
    [result.missingTableRows, "result.missingTableRows"],
    [result.presentForbiddenResponseText, "result.presentForbiddenResponseText"],
    [result.presentForbiddenResponsePatterns, "result.presentForbiddenResponsePatterns"],
    [result.missingSkills, "result.missingSkills"],
    [result.calledForbiddenSkills, "result.calledForbiddenSkills"],
    [result.missingExecutionText, "result.missingExecutionText"],
  ];
  const arrayReference = arrays.find(([values]) => values.length > 0)?.[1];
  if (arrayReference !== undefined) return arrayReference;
  if (!result.skillOrderValid) return "result.skillOrderValid";
  if (!result.legacyDocMethodValid) return "result.legacyDocMethodValid";
  if (!result.legacyDocOrderValid) return "result.legacyDocOrderValid";
  if (result.verifiedDeliverables.length !== result.expectedDeliverables)
    return "result.verifiedDeliverables";
  if (result.error !== null) return "run.error";
  return "result.evaluator";
}

export function evidenceClassification(result: {
  error: string | null;
  inferenceFailures: number;
  passed: boolean;
  productEvidenceReference: M3EvidenceReference;
  productFailure?: boolean;
  qualityCandidate: M3QualityCandidate | null;
  state: string;
}): { evidenceReference: M3EvidenceReference | null; failureClass: M3EvaluatorFailureClass } {
  if (result.passed) return { failureClass: "passed", evidenceReference: null };
  if (result.qualityCandidate !== null) {
    return { failureClass: "product_failure", evidenceReference: "run.error" };
  }
  if (result.inferenceFailures > 0) {
    return { failureClass: "runtime_failure", evidenceReference: "trace.inferenceFailures" };
  }
  if ((result.state !== "succeeded" || result.error !== null) && result.productFailure !== true) {
    return { failureClass: "runtime_failure", evidenceReference: "run.error" };
  }
  return { failureClass: "product_failure", evidenceReference: result.productEvidenceReference };
}

export function reportEvidenceClassification(input: {
  caseResults: Array<
    Pick<
      { failureClass: M3FailureClass; evidenceReference: M3EvidenceReference | null },
      "failureClass" | "evidenceReference"
    >
  >;
  passed: boolean;
  reportFailure?: {
    evidenceReference: M3EvidenceReference;
    failureClass: Exclude<M3FailureClass, "passed" | "model_limit">;
  };
}): { evidenceReference: M3EvidenceReference | null; failureClass: M3EvaluatorFailureClass } {
  if (input.passed) return { failureClass: "passed", evidenceReference: null };
  const results = [
    ...input.caseResults,
    ...(input.reportFailure === undefined ? [] : [input.reportFailure]),
  ];
  const result = ["runtime_failure", "environment_blocked", "harness_failure", "product_failure"]
    .flatMap((failureClass) =>
      results.filter(
        (candidate) =>
          candidate.failureClass === failureClass && candidate.evidenceReference !== null,
      ),
    )
    .at(0);
  if (
    result === undefined ||
    result.evidenceReference === null ||
    result.failureClass === "passed" ||
    result.failureClass === "model_limit"
  ) {
    return { failureClass: "product_failure", evidenceReference: "result.evaluator" };
  }
  return {
    failureClass: result.failureClass,
    evidenceReference: result.evidenceReference,
  };
}

import type { AgentTrace } from "@vault/shared";
import { describe, expect, it } from "vitest";
import {
  concurrentReportFailure,
  contextCompactionCount,
  evidenceClassification,
  failedEvaluationEvidence,
  reportEvidenceClassification,
} from "./m3-evidence-classification.js";
import {
  StressProductCheckFailure,
  StressRuntimeFailure,
  stressFailureStage,
} from "./m3-stress-runtime.js";

const failedCase = [
  {
    failureClass: "product_failure" as const,
    evidenceReference: "result.missingTokens" as const,
  },
];

function traceWithPrompts(...prompts: string[]): AgentTrace {
  return {
    captureVersion: 1,
    turns: prompts.map((prompt) => ({ prompt })),
  } as AgentTrace;
}

describe("M3 compaction evidence", () => {
  it("counts in-run anchored workspace state and ignores cross-run summaries", () => {
    expect(
      contextCompactionCount(traceWithPrompts("<anchored-summary>cross-run</anchored-summary>")),
    ).toBe(0);
    expect(
      contextCompactionCount(
        traceWithPrompts(
          "plain prompt",
          "<anchored-summary>current</anchored-summary>\n<workspace-state>{}</workspace-state>",
        ),
      ),
    ).toBe(1);
  });
});

describe("M3 report evidence classification", () => {
  it("does not promote a standalone quality failure to a model limit", () => {
    expect(reportEvidenceClassification({ caseResults: failedCase, passed: false })).toMatchObject({
      failureClass: "product_failure",
      evidenceReference: "result.missingTokens",
    });
    expect(
      reportEvidenceClassification({
        caseResults: [{ failureClass: "model_limit", evidenceReference: "result.evaluator" }],
        passed: false,
      }),
    ).toMatchObject({ failureClass: "product_failure", evidenceReference: "result.evaluator" });
  });

  it("classifies interrupted reports from the runner stage", () => {
    for (const stage of ["cli_input", "fixture", "evaluator", "report"] as const) {
      expect(failedEvaluationEvidence(stage)).toMatchObject({
        failureClass: "harness_failure",
        evidenceReference: "report.failure",
        failure: { stage, code: `m3_${stage}_failure` },
      });
    }
    expect(failedEvaluationEvidence("environment_setup")).toMatchObject({
      failureClass: "environment_blocked",
      failure: { stage: "environment_setup", code: "m3_environment_setup_blocked" },
    });
    for (const stage of ["runtime_startup", "runtime_transport"] as const) {
      expect(failedEvaluationEvidence(stage)).toMatchObject({
        failureClass: "runtime_failure",
        failure: { stage, code: `m3_${stage}_failure` },
      });
    }
    expect(failedEvaluationEvidence("product_hard_check")).toMatchObject({
      failureClass: "product_failure",
      failure: { stage: "product_hard_check", code: "m3_product_hard_check_failure" },
    });
  });
});

describe("M3 report failure evidence", () => {
  it("records a concurrent-capacity failure as report evidence", () => {
    expect(concurrentReportFailure(null)).toBeUndefined();
    expect(concurrentReportFailure(3)).toBeUndefined();
    const reportFailure = concurrentReportFailure(2);
    expect(reportFailure).toEqual({
      failureClass: "product_failure",
      evidenceReference: "report.maximumRunning",
    });
    if (reportFailure === undefined) throw new Error("Missing concurrent-capacity report failure.");
    expect(
      reportEvidenceClassification({ caseResults: [], passed: false, reportFailure }),
    ).toMatchObject(reportFailure);
  });

  it("prioritizes infrastructure evidence over an earlier product failure", () => {
    expect(
      reportEvidenceClassification({
        caseResults: [
          { failureClass: "product_failure", evidenceReference: "result.missingTokens" },
          { failureClass: "harness_failure", evidenceReference: "report.failure" },
          { failureClass: "runtime_failure", evidenceReference: "trace.inferenceFailures" },
        ],
        passed: false,
        reportFailure: {
          failureClass: "product_failure",
          evidenceReference: "report.maximumRunning",
        },
      }),
    ).toEqual({ failureClass: "runtime_failure", evidenceReference: "trace.inferenceFailures" });
  });
});

describe("M3 runner failure stages", () => {
  it("keeps raw fixture, evaluator, and report failures in their harness stages", () => {
    expect(stressFailureStage(new Error(), "fixture")).toBe("fixture");
    expect(stressFailureStage(new Error(), "evaluator")).toBe("evaluator");
    expect(stressFailureStage(new Error(), "report")).toBe("report");
    expect(stressFailureStage(new StressRuntimeFailure(), "evaluator")).toBe("runtime_transport");
    expect(stressFailureStage(new StressProductCheckFailure(), "fixture")).toBe(
      "product_hard_check",
    );
  });
});

describe("M3 hard-check evidence", () => {
  it("keeps a product hard check as product evidence after a terminal run", () => {
    expect(
      evidenceClassification({
        error: "Expected no artifacts.",
        inferenceFailures: 0,
        passed: false,
        productEvidenceReference: "result.producedArtifacts",
        productFailure: true,
        qualityCandidate: null,
        state: "failed",
      }),
    ).toEqual({ failureClass: "product_failure", evidenceReference: "result.producedArtifacts" });
  });
});

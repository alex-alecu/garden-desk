import { stat } from "node:fs/promises";
import {
  failedEvaluationEvidence,
  type M3EvaluationFailureStage,
} from "../stress/m3-evidence-classification.js";

type CanonicalGateFailureStage = Extract<
  M3EvaluationFailureStage,
  "environment_setup" | "runtime_startup" | "runtime_transport"
>;

type CanonicalGateFailureClassification = "m3_macos_gate_failed" | "m3_windows_gate_failed";

export class M3ProductCheckFailure extends Error {
  override readonly name = "M3ProductCheckFailure";
}

export function requireM3ProductCheck(condition: boolean, message: string): asserts condition {
  if (!condition) throw new M3ProductCheckFailure(message);
}

export async function requireM3RegularFile(path: string, message: string): Promise<void> {
  try {
    requireM3ProductCheck((await stat(path)).isFile(), message);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new M3ProductCheckFailure(message);
    }
    throw error;
  }
}

export async function runCanonicalGate(input: {
  failureClassification: CanonicalGateFailureClassification;
  run: (setFailureStage: (stage: CanonicalGateFailureStage) => void) => Promise<void>;
}): Promise<void> {
  let failureStage: M3EvaluationFailureStage = "environment_setup";
  try {
    await input.run((stage) => {
      failureStage = stage;
    });
  } catch (error) {
    if (error instanceof M3ProductCheckFailure) failureStage = "product_hard_check";
    console.error(
      JSON.stringify({
        classification: input.failureClassification,
        ...failedEvaluationEvidence(failureStage),
      }),
    );
    process.exitCode = 1;
  }
}

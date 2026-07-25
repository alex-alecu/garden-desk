import type { AuditEventInput, InferenceOperation, RequestId } from "@vault/shared";

type AuditAppender = (event: AuditEventInput) => void;

export function recordInferenceAudit(
  audit: AuditAppender,
  input: {
    operation: InferenceOperation;
    requestId: RequestId;
    jobId: string;
    outcome: "succeeded" | "failed";
    code?: string;
  },
): void {
  audit({
    type: `inference.${input.operation}`,
    outcome: input.outcome,
    metadata: {
      requestId: input.requestId,
      jobId: input.jobId,
      ...(input.code === undefined ? {} : { code: input.code }),
    },
  });
}

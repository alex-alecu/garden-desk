import type { AgentExecutionSnapshot, AgentRunSnapshot } from "@vault/shared";

export interface CompletedEvidenceRequest {
  finishToken: string;
  startToken: string;
  stdoutTruncated: boolean;
}

export interface BoundedOutputEvidenceRequest {
  startToken: string;
}

export interface AgentEvidenceRequest {
  cancel: boolean;
  expectedError?: string;
  finishToken?: string;
  startToken: string;
  stdoutTruncated: boolean;
}

export function hasRunningLiveMarker(snapshot: AgentRunSnapshot, token: string): boolean {
  return (
    snapshot.run.state === "running" &&
    snapshot.executions.some(
      (execution) => execution.state === "running" && execution.stdout.includes(token),
    )
  );
}

export function hasRunningExecution(snapshot: AgentRunSnapshot): boolean {
  return snapshot.executions.some(
    (item) =>
      item.state === "running" &&
      item.vmDiagnostics.some((diagnostic) => diagnostic.code === "process_start"),
  );
}

export function completedEvidence(
  snapshot: AgentRunSnapshot,
  request: CompletedEvidenceRequest,
): AgentExecutionSnapshot | undefined {
  return snapshot.executions.find(
    (execution) =>
      execution.state === "completed" &&
      execution.exitCode === 0 &&
      execution.stdoutTruncated === request.stdoutTruncated &&
      execution.stdout.includes(request.startToken) &&
      execution.stdout.includes(request.finishToken) &&
      execution.vmDiagnostics.length > 0,
  );
}

export function boundedOutputEvidence(
  snapshot: AgentRunSnapshot,
  request: BoundedOutputEvidenceRequest,
): AgentExecutionSnapshot | undefined {
  return snapshot.executions.find(
    (execution) =>
      execution.state === "failed" &&
      execution.termination === "resource_limit" &&
      execution.stdoutBytes === 1_000_000 &&
      execution.stdoutTruncated &&
      execution.stdout.includes(request.startToken) &&
      execution.vmDiagnostics.some((diagnostic) => diagnostic.code === "process_start") &&
      execution.vmDiagnostics.some((diagnostic) => diagnostic.code === "process_exit"),
  );
}

export function cancelledEvidence(snapshot: AgentRunSnapshot): AgentExecutionSnapshot | undefined {
  return snapshot.executions.find(
    (execution) => execution.state === "cancelled" && execution.vmDiagnostics.length > 0,
  );
}

export function selectedAgentEvidence(
  snapshot: AgentRunSnapshot,
  request: AgentEvidenceRequest,
): AgentExecutionSnapshot | undefined {
  if (request.cancel) return cancelledEvidence(snapshot);
  if (request.finishToken === undefined) return undefined;
  return completedEvidence(snapshot, {
    finishToken: request.finishToken,
    startToken: request.startToken,
    stdoutTruncated: request.stdoutTruncated,
  });
}

export function matchesTerminalAgentEvidence(
  snapshot: AgentRunSnapshot,
  execution: AgentExecutionSnapshot,
  request: AgentEvidenceRequest,
): boolean {
  if (execution.vmDiagnostics.length === 0) return false;
  if (request.cancel) return snapshot.run.state === "cancelled" && execution.state === "cancelled";
  return request.expectedError === undefined
    ? snapshot.run.state === "succeeded"
    : snapshot.run.state === "failed" && snapshot.run.error === request.expectedError;
}

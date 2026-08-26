import type { AgentRunSnapshot } from "@vault/shared";
import { requireM3ProductCheck } from "./m3-canonical-gate-reporting.js";

interface ProcessBoundary {
  at: number;
  kind: "end" | "start";
  snapshot: number;
}

function executionBoundaries(
  execution: AgentRunSnapshot["executions"][number],
  snapshotIndex: number,
): ProcessBoundary[] | undefined {
  const starts = execution.vmDiagnostics.filter((item) => item.code === "process_start");
  const exits = execution.vmDiagnostics.filter((item) => item.code === "process_exit");
  if (starts.length !== 1 || exits.length !== 1) return undefined;
  const startedAt = Date.parse(starts.at(0)?.createdAt ?? "");
  const completedAt = Date.parse(exits.at(0)?.createdAt ?? "");
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt <= startedAt) {
    return undefined;
  }
  return [
    { at: startedAt, kind: "start", snapshot: snapshotIndex },
    { at: completedAt, kind: "end", snapshot: snapshotIndex },
  ];
}

function processBoundaries(
  snapshot: AgentRunSnapshot,
  snapshotIndex: number,
): ProcessBoundary[] | undefined {
  if (snapshot.run.state === "queued" || snapshot.run.state === "running") return undefined;
  const completed = snapshot.executions.filter(
    (execution) =>
      execution.state === "completed" &&
      execution.termination === "completed" &&
      execution.exitCode === 0,
  );
  if (completed.length === 0) return undefined;
  const boundaries: ProcessBoundary[] = [];
  for (const execution of completed) {
    const found = executionBoundaries(execution, snapshotIndex);
    if (found === undefined) return undefined;
    boundaries.push(...found);
  }
  return boundaries.length === 0 ? undefined : boundaries;
}

export function maximumAgentProcessOverlap(snapshots: AgentRunSnapshot[]): number {
  const boundaries: ProcessBoundary[] = [];
  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const snapshotBoundaries = processBoundaries(snapshot, snapshotIndex);
    if (snapshotBoundaries === undefined) return 0;
    boundaries.push(...snapshotBoundaries);
  }
  boundaries.sort(
    (left, right) =>
      left.at - right.at || (left.kind === right.kind ? 0 : left.kind === "end" ? -1 : 1),
  );
  const active = new Map<number, number>();
  let maximum = 0;
  for (const boundary of boundaries) {
    const count = active.get(boundary.snapshot) ?? 0;
    if (boundary.kind === "start") active.set(boundary.snapshot, count + 1);
    else if (count <= 1) active.delete(boundary.snapshot);
    else active.set(boundary.snapshot, count - 1);
    maximum = Math.max(maximum, active.size);
  }
  return maximum;
}

function maximumAgentVmOverlap(snapshots: AgentRunSnapshot[], observedAt: number): number {
  const intervals = snapshots.map((snapshot) => {
    const diagnostics = snapshot.executions.flatMap((execution) => execution.vmDiagnostics);
    const startedAt = diagnostics
      .filter((diagnostic) => diagnostic.code === "vm_start")
      .map((diagnostic) => Date.parse(diagnostic.createdAt))
      .sort((left, right) => left - right)[0];
    const completedAt = diagnostics
      .filter((diagnostic) => diagnostic.code === "teardown")
      .map((diagnostic) => Date.parse(diagnostic.createdAt))
      .sort((left, right) => right - left)[0];
    requireM3ProductCheck(
      startedAt !== undefined && Number.isFinite(startedAt),
      `Real agent VM start evidence is missing: ${JSON.stringify(snapshot)}`,
    );
    return { startedAt, completedAt: completedAt ?? observedAt };
  });
  const boundaries = intervals.flatMap((interval) => [
    { at: interval.startedAt, change: 1 },
    { at: interval.completedAt, change: -1 },
  ]);
  boundaries.sort((left, right) => left.at - right.at || left.change - right.change);
  let active = 0;
  let maximum = 0;
  for (const boundary of boundaries) {
    active += boundary.change;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

export function macOsAgentOverlapEvidence(
  snapshots: AgentRunSnapshot[],
  observedAt: number,
): { maximumOverlappingVms: number } {
  const maximumOverlappingVms = maximumAgentVmOverlap(snapshots, observedAt);
  requireM3ProductCheck(maximumOverlappingVms >= 2, "Real agent VM lifetimes did not overlap.");
  return { maximumOverlappingVms };
}

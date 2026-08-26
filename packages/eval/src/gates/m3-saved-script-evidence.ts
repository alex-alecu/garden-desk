import type { AgentExecutionSnapshot, AgentRunSnapshot } from "@vault/shared";
import { M3ProductCheckFailure } from "./m3-canonical-gate-reporting.js";

export interface SavedScriptRequirement {
  brokenSource: string;
  finalOutput: string;
  language: "python" | "node";
  path: string;
  repairedSource: string;
}

export interface SavedScriptRepairEvidence {
  failures: string[];
  observations: {
    repair: "resaved_source" | "edited_saved_file" | "not_recorded";
    rerun: "path_only" | "full_source" | "not_recorded";
  };
  passed: boolean;
  recordedExecutedSource: string | null;
}

function matchesScript(
  execution: AgentExecutionSnapshot,
  requirement: SavedScriptRequirement,
): boolean {
  return execution.language === requirement.language && execution.path === requirement.path;
}

function hasProcessEvidence(execution: AgentExecutionSnapshot): boolean {
  return (
    execution.vmDiagnostics.some((item) => item.code === "process_start") &&
    execution.vmDiagnostics.some((item) => item.code === "process_exit")
  );
}

function toolSources(
  snapshot: AgentRunSnapshot,
  requirement: SavedScriptRequirement,
): Array<string | null> {
  return snapshot.events
    .filter(
      (event) =>
        event.type === "tool.started" &&
        event.language === requirement.language &&
        event.path === requirement.path,
    )
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.source);
}

function auditEventsPresent(
  snapshot: AgentRunSnapshot,
  requirement: SavedScriptRequirement,
): boolean {
  const matching = snapshot.events.filter(
    (event) => event.language === requirement.language && event.path === requirement.path,
  );
  return (
    matching.filter((event) => event.type === "execution.started").length >= 3 &&
    matching.filter((event) => event.type === "execution.completed").length >= 3
  );
}

function repairObservation(sources: Array<string | null>, requirement: SavedScriptRequirement) {
  const source = sources[1];
  if (typeof source === "string" && source !== requirement.brokenSource) {
    return "resaved_source" as const;
  }
  if (source === null) return "edited_saved_file" as const;
  return "not_recorded" as const;
}

function rerunObservation(sources: Array<string | null>) {
  const source = sources[2];
  if (source === null) return "path_only" as const;
  if (typeof source === "string") return "full_source" as const;
  return "not_recorded" as const;
}

function repairFailures(input: {
  failed: AgentExecutionSnapshot | undefined;
  repaired: AgentExecutionSnapshot[];
  requirement: SavedScriptRequirement;
  snapshot: AgentRunSnapshot;
}): string[] {
  const { failed, repaired, requirement, snapshot } = input;
  const failures: string[] = [];
  if (snapshot.run.state !== "succeeded") failures.push("terminal_run_not_succeeded");
  if (!snapshot.run.response?.includes(requirement.finalOutput)) {
    failures.push("missing_final_response_output");
  }
  if (failed === undefined) failures.push("missing_failed_execution");
  else if (!hasProcessEvidence(failed)) failures.push("missing_typed_failure_evidence");
  if (repaired.length === 0) failures.push("missing_stable_repaired_source");
  if (repaired.length < 2) failures.push("missing_saved_script_rerun");
  if (repaired.some((execution) => !hasProcessEvidence(execution))) {
    failures.push("missing_typed_repair_evidence");
  }
  if (!auditEventsPresent(snapshot, requirement)) failures.push("missing_typed_audit_evidence");
  return failures;
}

export function savedScriptRepairEvidence(
  snapshot: AgentRunSnapshot,
  requirement: SavedScriptRequirement,
): SavedScriptRepairEvidence {
  const scripts = snapshot.executions
    .filter((execution) => matchesScript(execution, requirement))
    .sort((left, right) => left.sequence - right.sequence);
  const failed = scripts.find(
    (execution) =>
      execution.state === "failed" &&
      execution.exitCode !== null &&
      execution.exitCode !== 0 &&
      execution.termination === "crash" &&
      execution.source === requirement.brokenSource,
  );
  const successfulRepairs = scripts.filter(
    (execution) =>
      failed !== undefined &&
      execution.sequence > failed.sequence &&
      execution.state === "completed" &&
      execution.exitCode === 0 &&
      execution.termination === "completed" &&
      execution.stdout.includes(requirement.finalOutput),
  );
  const stableSource = successfulRepairs.find(
    (execution, index) =>
      typeof execution.source === "string" &&
      execution.source.length > 0 &&
      successfulRepairs.slice(index + 1).some((later) => later.source === execution.source),
  )?.source;
  const repaired =
    stableSource === undefined
      ? []
      : successfulRepairs.filter((execution) => execution.source === stableSource);
  const failures = repairFailures({ failed, repaired, requirement, snapshot });
  const sources = toolSources(snapshot, requirement);
  const rerun = repaired.at(-1);
  return {
    failures,
    observations: {
      repair: repairObservation(sources, requirement),
      rerun: rerunObservation(sources),
    },
    passed: failures.length === 0,
    recordedExecutedSource: rerun?.source ?? null,
  };
}

export function requireSavedScriptRepairEvidence(
  snapshot: AgentRunSnapshot,
  requirement: SavedScriptRequirement,
): SavedScriptRepairEvidence {
  const evidence = savedScriptRepairEvidence(snapshot, requirement);
  if (!evidence.passed)
    throw new M3ProductCheckFailure(
      `Saved-script repair evidence failed: ${evidence.failures.join(",")}`,
    );
  return evidence;
}

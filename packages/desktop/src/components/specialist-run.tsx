import type { AgentRunSummary } from "@gardendesk/shared";
import { Icon } from "./icons.js";

const identities = {
  "financial-reconciliation": {
    name: "Financial reconciliation",
    icon: "reconcile",
    color: "teal",
  },
  "folder-intake": { name: "Folder intake", icon: "folder-tree", color: "blue" },
  "matter-chronology": { name: "Matter chronology", icon: "timeline", color: "gold" },
  "contract-obligations": { name: "Contract obligations", icon: "document-check", color: "violet" },
  "document-comparison": { name: "Document comparison", icon: "compare", color: "rose" },
  "financial-record-extraction": {
    name: "Financial record extraction",
    icon: "table-extract",
    color: "cyan",
  },
} as const;

export function specialistIdentity(agentId: string | null | undefined) {
  return (
    identities[agentId as keyof typeof identities] ?? {
      name: "Task",
      icon: "subagent" as const,
      color: "neutral",
    }
  );
}

export function specialistStatus(state: AgentRunSummary["state"]) {
  return {
    queued: "Waiting",
    running: "Working",
    succeeded: "Complete",
    failed: "Failed",
    cancelled: "Stopped",
  }[state];
}

export function SpecialistIcon({ agentId }: { agentId: string | null | undefined }) {
  const identity = specialistIdentity(agentId);
  return (
    <span className={`specialist-icon specialist-${identity.color}`}>
      <Icon name={identity.icon} />
    </span>
  );
}

export function SpecialistRunRow({
  run,
  onOpen,
}: {
  run: AgentRunSummary;
  onOpen(run: AgentRunSummary): void;
}) {
  const identity = specialistIdentity(run.agentId);
  return (
    <button
      className="specialist-run-row"
      id={`specialist-run-${run.id}`}
      onClick={() => onOpen(run)}
      type="button"
    >
      <SpecialistIcon agentId={run.agentId} />
      <span className="specialist-run-text">
        <strong>{identity.name}</strong>
        <span>{run.assignment}</span>
      </span>
      <span className="specialist-run-status">{specialistStatus(run.state)}</span>
      <Icon name="chevron-right" />
    </button>
  );
}

export function SpecialistRunRows({
  runs,
  onOpen,
}: {
  runs: AgentRunSummary[] | undefined;
  onOpen: ((run: AgentRunSummary) => void) | undefined;
}) {
  return onOpen === undefined
    ? null
    : runs?.map((run) => <SpecialistRunRow key={run.id} run={run} onOpen={onOpen} />);
}

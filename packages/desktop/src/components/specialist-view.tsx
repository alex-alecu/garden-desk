import type { AgentRunSummary } from "@gardendesk/shared";
import { useEffect, useRef } from "react";
import type { DesktopState, TimelineItem } from "../state.js";
import { Conversation } from "./conversation.js";
import { Icon } from "./icons.js";
import { specialistIdentity } from "./specialist-run.js";

export function SpecialistView({
  run,
  state,
  unavailable,
  onSelectStep,
}: {
  run: AgentRunSummary;
  state: DesktopState;
  unavailable: boolean;
  onSelectStep(stepId: string | undefined): void;
}) {
  const current = state.activeRun ?? run;
  const timeline: TimelineItem[] = [
    {
      id: `assignment-${run.id}`,
      createdAt: run.createdAt,
      kind: "user",
      text: run.assignment ?? specialistIdentity(run.agentId).name,
      runId: run.id,
    },
    ...state.timeline.filter((item) => item.eventType !== "inference.started"),
  ];
  if (unavailable || state.activeRun === undefined)
    timeline.push({
      id: `status-${run.id}`,
      createdAt: current.updatedAt,
      kind: "assistant",
      text: unavailable ? "Current status is unavailable." : "Loading activity…",
    });
  return (
    <Conversation
      artifacts={[]}
      timeline={timeline}
      ready
      onSuggestion={() => undefined}
      onSelectStep={onSelectStep}
      performance={current.performance}
      runId={run.id}
      selectedStepId={state.selectedStepId}
      working={current.state === "queued" || current.state === "running"}
      activeRunState={current.state}
    />
  );
}

export function SpecialistActions({
  needsAnswer,
  running,
  onBack,
  onCancel,
}: {
  needsAnswer: boolean;
  running: boolean;
  onBack(): void;
  onCancel(): void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  return (
    <div className="composer-actions specialist-actions">
      <button
        className="activity-row-label specialist-back"
        onClick={onBack}
        ref={back}
        type="button"
      >
        <Icon name="chevron-left" />
        Go back
      </button>
      {needsAnswer ? (
        <button className="activity-row-label" onClick={onBack} type="button">
          Your answer is needed
        </button>
      ) : null}
      {running ? (
        <button className="stop-button" onClick={onCancel} type="button">
          Stop task
        </button>
      ) : null}
    </div>
  );
}

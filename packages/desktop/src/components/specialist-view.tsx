import type { AgentRunSummary } from "@gardendesk/shared";
import { useEffect, useRef } from "react";
import type { DesktopState } from "../state.js";
import { Conversation } from "./conversation.js";
import { Icon } from "./icons.js";
import { SpecialistIcon, specialistIdentity, specialistStatus } from "./specialist-run.js";

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
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const current = state.activeRun ?? run;
  const timeline = state.timeline.filter((item) => item.eventType !== "inference.started");
  return (
    <div className="specialist-view">
      <header className="specialist-view-header">
        <SpecialistIcon agentId={run.agentId} />
        <h2 ref={title} tabIndex={-1}>
          {specialistIdentity(run.agentId).name}
        </h2>
        <span className="specialist-run-status" role="status">
          {unavailable ? "Status unavailable" : specialistStatus(current.state)}
        </span>
        <p>{run.assignment}</p>
      </header>
      {timeline.some((item) => item.eventType !== "run.started") ? (
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
      ) : (
        <p className="specialist-loading" role="status">
          {unavailable ? "Work could not be loaded." : "Loading activity…"}
        </p>
      )}
    </div>
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
  return (
    <div className="specialist-actions">
      <button onClick={onBack} type="button">
        <Icon name="chevron-left" />
        Go back
      </button>
      {needsAnswer ? (
        <button className="specialist-answer" onClick={onBack} type="button">
          Your answer is needed
        </button>
      ) : null}
      {running ? (
        <button className="specialist-stop" onClick={onCancel} type="button">
          Stop task
        </button>
      ) : null}
    </div>
  );
}

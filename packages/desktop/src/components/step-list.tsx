import type { AgentStep } from "../steps.js";
import { StepDetails } from "./step-details.js";

interface StepListProps {
  steps: AgentStep[];
  selectedStepId: string | undefined;
  thinking: string | null;
  thinkingStepId: string | undefined;
  onSelectStep(stepId: string | undefined): void;
}

function StepRow({
  step,
  selected,
  thinking,
  onSelectStep,
}: {
  step: AgentStep;
  selected: boolean;
  thinking: string | null;
  onSelectStep(stepId: string | undefined): void;
}) {
  return (
    <article className="technical-details-item technical-log-item">
      <button
        aria-controls={`step-${step.id}-details`}
        aria-expanded={selected}
        className="execution-toggle"
        onClick={() => onSelectStep(selected ? undefined : step.id)}
        type="button"
      >
        <span>
          Step {step.ordinal} · {step.title}
        </span>
      </button>
      {selected ? (
        <div id={`step-${step.id}-details`}>
          <StepDetails step={step} thinking={thinking} />
        </div>
      ) : null}
    </article>
  );
}

export function StepList({
  steps,
  selectedStepId,
  thinking,
  thinkingStepId,
  onSelectStep,
}: StepListProps) {
  if (steps.length === 0) {
    return <p className="technical-details-empty">Steps appear here while a task runs.</p>;
  }
  return (
    <>
      {steps.map((step) => (
        <StepRow
          key={step.id}
          onSelectStep={onSelectStep}
          selected={step.id === selectedStepId}
          step={step}
          thinking={step.id === selectedStepId && step.id === thinkingStepId ? thinking : null}
        />
      ))}
    </>
  );
}

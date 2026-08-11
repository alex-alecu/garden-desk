import type { AgentStep } from "../steps.js";
import { SourceCode } from "./source-code.js";
import { ExecutionStatus, StreamTabs } from "./technical-logs.js";

function TextBlock({ label, value }: { label: string; value: string }) {
  return (
    <details className="step-detail-block">
      <summary>{label}</summary>
      <div className="technical-log-viewer">
        <textarea aria-label={label} readOnly value={value} />
      </div>
    </details>
  );
}

function StepEvidence({ step }: { step: AgentStep }) {
  const execution = step.execution;
  if (execution === undefined) return null;
  const source = execution.source ?? execution.command;
  const path = execution.path ?? "Guest shell command";
  return (
    <>
      <p>
        Termination: {execution.termination ?? "in progress"}
        {execution.exitCode === null ? "" : ` · exit ${execution.exitCode}`}
      </p>
      {source === null ? null : (
        <details className="step-detail-block">
          <summary>Code the model wrote</summary>
          <SourceCode language={execution.language} path={path} source={source} />
        </details>
      )}
      <StreamTabs execution={execution} />
    </>
  );
}

function StepInference({ step, thinking }: { step: AgentStep; thinking: string | null }) {
  const turn = step.turn;
  if (turn === undefined) {
    return (
      <p className="step-detail-empty">
        Recorded prompts are not loaded for this task. Older tasks report them as not recorded.
      </p>
    );
  }
  return (
    <>
      <p>
        {turn.modelId} · {turn.allocatedContextTokens ?? "unknown"} context tokens ·{" "}
        {turn.outcome ?? "in progress"}
      </p>
      {thinking === null || thinking.length === 0 ? null : (
        <TextBlock label="Thinking (this step only, not retained)" value={thinking} />
      )}
      <TextBlock label="Prompt sent to the model" value={turn.prompt} />
      <TextBlock label="Requested result shape" value={JSON.stringify(turn.jsonSchema, null, 2)} />
      <TextBlock
        label="Model decision"
        value={
          turn.structuredResponse === null
            ? "No decision was recorded for this turn."
            : JSON.stringify(turn.structuredResponse, null, 2)
        }
      />
    </>
  );
}

export function StepDetails({ step, thinking }: { step: AgentStep; thinking: string | null }) {
  return (
    <div className="step-details">
      <div className="execution-heading">
        <p>
          Step {step.ordinal} · {step.execution?.language ?? step.kind}
        </p>
        {step.execution === undefined ? null : <ExecutionStatus execution={step.execution} />}
      </div>
      <p className="step-detail-title">{step.title}</p>
      {step.execution === undefined && step.detail !== undefined ? (
        <TextBlock label="Details" value={step.detail} />
      ) : null}
      <StepEvidence step={step} />
      <StepInference step={step} thinking={thinking} />
    </div>
  );
}

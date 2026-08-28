import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentStep } from "../steps.js";
import { followThinkingText } from "../thinking-scroll.js";
import { Icon } from "./icons.js";
import { SourceCode } from "./source-code.js";
import { ExecutionStatus, StreamTabs } from "./technical-logs.js";
import { copyUserMessage } from "./user-message.js";

type CopyState = "copied" | "failed" | "idle";

function copyLabel(state: CopyState): string {
  if (state === "copied") return "Copied";
  if (state === "failed") return "Copy failed";
  return "Copy";
}

export async function copyStepText(
  value: string,
  clipboard?: Pick<Clipboard, "writeText">,
): Promise<void> {
  await copyUserMessage(value, clipboard ?? globalThis.navigator?.clipboard);
}

function StepTextBlock({
  label,
  value,
  live = false,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  const [wrap, setWrap] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const valueViewer = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );
  useLayoutEffect(() => {
    if (live && valueViewer.current !== null) followThinkingText(valueViewer.current);
  });
  const copy = async () => {
    try {
      await copyStepText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  };
  const copyButtonLabel = copyLabel(copyState);
  return (
    <details className="step-detail-block" open={live || undefined}>
      <summary>{label}</summary>
      <div className="technical-log-viewer">
        <textarea
          className={wrap ? "step-detail-wrap" : undefined}
          aria-label={label}
          readOnly
          ref={valueViewer}
          value={value}
        />
        <footer className="step-detail-controls">
          <label>
            <input
              aria-label={`Wrap text for ${label}`}
              checked={wrap}
              onChange={(event) => setWrap(event.currentTarget.checked)}
              type="checkbox"
            />
            Wrap text
          </label>
          <button
            aria-label={`${copyButtonLabel} ${label}`}
            onClick={() => void copy()}
            title={copyButtonLabel}
            type="button"
          >
            <Icon name={copyState === "copied" ? "copy-check" : "copy"} />
            <span aria-live="polite">{copyButtonLabel}</span>
          </button>
        </footer>
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
      {source === null && execution.path !== null ? (
        <p>
          Source path: <code>{execution.path}</code>
        </p>
      ) : source === null ? null : (
        <details className="step-detail-block">
          <summary>Code the model wrote</summary>
          <SourceCode language={execution.language} path={path} source={source} />
        </details>
      )}
      <StreamTabs execution={execution} />
    </>
  );
}

function StepInference({
  step,
  thinking,
  thinkingLive,
}: {
  step: AgentStep;
  thinking: string | null;
  thinkingLive: boolean;
}) {
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
        <StepTextBlock
          label="Thinking (cleared when Vault Desk closes)"
          live={thinkingLive}
          value={thinking}
        />
      )}
      <StepTextBlock label="Prompt sent to the model" value={turn.prompt} />
      <StepTextBlock
        label="Requested result shape"
        value={JSON.stringify(turn.jsonSchema, null, 2)}
      />
      <StepTextBlock
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

export function StepDetails({
  step,
  thinking,
  thinkingLive = false,
}: {
  step: AgentStep;
  thinking: string | null;
  thinkingLive?: boolean;
}) {
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
        <StepTextBlock label="Details" value={step.detail} />
      ) : null}
      <StepEvidence step={step} />
      <StepInference step={step} thinking={thinking} thinkingLive={thinkingLive} />
    </div>
  );
}

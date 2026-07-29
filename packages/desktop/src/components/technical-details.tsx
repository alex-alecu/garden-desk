import type {
  AgentArtifactSummary,
  AgentExecutionSnapshot,
  ModelRuntimeStatus,
} from "@vault/shared";
import { useReducer } from "react";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import type { DesktopApi } from "../api.js";
import {
  type DebugSnapshotState,
  debugSnapshotReducer,
  initialDebugSnapshotState,
} from "../debug-snapshot.js";
import { modelUsage } from "../model-usage.js";
import type { TimelineItem } from "../state.js";
import type { AgentStep } from "../steps.js";
import { Icon } from "./icons.js";
import { StepList } from "./step-list.js";

export { shouldFollowLog } from "./technical-logs.js";

interface TechnicalDetailsProps {
  api: DesktopApi;
  artifacts: AgentArtifactSummary[];
  catalogPath: string;
  executions: AgentExecutionSnapshot[];
  model: ModelRuntimeStatus;
  open: boolean;
  sessionId: string | undefined;
  timeline: TimelineItem[];
  steps: AgentStep[];
  selectedStepId: string | undefined;
  thinking: string | null;
  nativeActionMessage?: string | undefined;
  onClose(): void;
  onSelectStep(stepId: string | undefined): void;
}

function guestCapabilities(): string {
  const runtimes = Object.entries(capabilities.runtimes).map(
    ([name, version]) => `${name}: ${version}`,
  );
  return [
    `Source: ${capabilities.sourceMount.path} (${capabilities.sourceMount.mode}, live)`,
    `Workspace: ${capabilities.workspaceMount.path} (${capabilities.workspaceMount.maximumBytes} bytes)`,
    `Temporary runtime: ${capabilities.runtimeMount.path} (${capabilities.runtimeMount.maximumBytes} bytes, ephemeral)`,
    `Shell: ${capabilities.shell}`,
    "Runtimes:",
    ...runtimes,
    "Executables:",
    ...capabilities.executables,
  ].join("\n");
}

export function DebugSnapshotPanel({
  onCreate,
  onReveal,
  state,
}: {
  onCreate(): void;
  onReveal(): void;
  state: DebugSnapshotState;
}) {
  return (
    <div className="debug-snapshot-controls">
      <button disabled={state.creating || state.revealing} onClick={onCreate} type="button">
        {state.creating ? "Creating snapshot…" : "Create debug snapshot"}
      </button>
      {state.path === undefined ? null : (
        <>
          <input aria-label="Debug snapshot path" readOnly value={state.path} />
          <button disabled={state.revealing} onClick={onReveal} type="button">
            {state.revealing ? "Revealing…" : "Reveal snapshot"}
          </button>
        </>
      )}
      {state.error === undefined ? null : <p role="alert">{state.error}</p>}
    </div>
  );
}

function DebugSnapshotControls({
  api,
  nativeActionMessage,
  sessionId,
}: {
  api: DesktopApi;
  nativeActionMessage?: string | undefined;
  sessionId: string;
}) {
  const [state, dispatch] = useReducer(debugSnapshotReducer, initialDebugSnapshotState);
  const create = async () => {
    dispatch({ type: "create.start" });
    try {
      dispatch({ type: "create.succeeded", path: await api.createDebugSnapshot(sessionId) });
    } catch {
      dispatch({ type: "create.failed" });
    }
  };
  const reveal = async () => {
    dispatch({ type: "reveal.start" });
    try {
      await api.revealDebugSnapshot(sessionId);
      dispatch({ type: "reveal.succeeded" });
    } catch {
      dispatch({ type: "reveal.failed" });
    }
  };
  if (nativeActionMessage !== undefined) {
    return (
      <div className="debug-snapshot-controls">
        <button disabled title={nativeActionMessage} type="button">
          Create debug snapshot
        </button>
        <p>{nativeActionMessage}</p>
      </div>
    );
  }
  return (
    <DebugSnapshotPanel
      onCreate={() => void create()}
      onReveal={() => void reveal()}
      state={state}
    />
  );
}

function TechnicalModelUsage({ model }: { model: ModelRuntimeStatus }) {
  const usage = modelUsage(model);
  if (usage === undefined) return null;
  return (
    <dl className="technical-model-usage">
      {usage.allocated === undefined ? null : (
        <div>
          <dt>Memory allocation</dt>
          <dd>{usage.allocated}</dd>
        </div>
      )}
      {usage.budget === undefined ? null : (
        <div>
          <dt>VRAM / unified memory budget</dt>
          <dd>{usage.budget}</dd>
        </div>
      )}
      {usage.context === undefined ? null : (
        <div>
          <dt>Context window</dt>
          <dd>{usage.context} tokens</dd>
        </div>
      )}
    </dl>
  );
}

function Overview({
  api,
  artifacts,
  catalogPath,
  executions,
  model,
  nativeActionMessage,
  onSelectStep,
  selectedStepId,
  sessionId,
  steps,
  thinking,
  timeline,
}: TechnicalDetailsProps) {
  const limits = timeline.find((item) => item.eventType === "run.started")?.text;
  return (
    <div className="technical-details-scroll" role="tabpanel" id="technical-overview-panel">
      {limits === undefined && executions.length === 0 && artifacts.length === 0 ? (
        <p className="technical-details-empty">Technical details will appear after a task runs.</p>
      ) : null}
      {sessionId === undefined ? null : (
        <article className="technical-details-item">
          <p className="technical-path">Local session ID: {sessionId}</p>
          <p className="technical-path">Catalog path: {catalogPath}</p>
          <p className="debug-snapshot-purpose">AI agent debugging snapshot</p>
          <p className="technical-limits">
            Create this for an AI coding agent such as Codex or Claude Code. It contains this
            session&apos;s SQLite-backed records, workspace, generated files, inference traces, and
            bounded microVM logs. Share it only through an approved channel.
          </p>
          <DebugSnapshotControls
            api={api}
            key={sessionId}
            nativeActionMessage={nativeActionMessage}
            sessionId={sessionId}
          />
        </article>
      )}
      <article className="technical-details-item">
        <p>Certified guest capabilities</p>
        <TechnicalModelUsage model={model} />
        {limits === undefined ? null : <p className="technical-limits">{limits}</p>}
        <details>
          <summary>Show tools and runtimes</summary>
          <pre>{guestCapabilities()}</pre>
        </details>
      </article>
      <StepList
        onSelectStep={onSelectStep}
        selectedStepId={selectedStepId}
        steps={steps}
        thinking={thinking}
      />
      {artifacts.map((item) => (
        <article className="technical-details-item" key={item.id}>
          <span className="activity-label">Generated file</span>
          <p>{item.name}</p>
          <dl className="technical-file-metadata">
            <div>
              <dt>Type</dt>
              <dd>{item.mediaType}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{item.byteLength} bytes</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function TechnicalDetails(props: TechnicalDetailsProps) {
  if (!props.open) return null;
  return (
    <aside aria-label="Technical details" className="technical-details-drawer">
      <header className="technical-details-header">
        <div>
          <h2>Technical details</h2>
          <p>Local limits, step evidence, prompts, and bounded logs</p>
        </div>
        <button aria-label="Close technical details" onClick={props.onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      <Overview {...props} />
    </aside>
  );
}

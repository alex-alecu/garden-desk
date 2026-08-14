import type {
  AgentArtifactSummary,
  AgentExecutionSnapshot,
  ModelRuntimeStatus,
} from "@vault/shared";
import { type CSSProperties, useEffect, useReducer, useState } from "react";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import type { DesktopApi } from "../api.js";
import {
  type DebugSnapshotState,
  debugSnapshotReducer,
  initialDebugSnapshotState,
} from "../debug-snapshot.js";
import type { TimelineItem } from "../state.js";
import type { AgentStep } from "../steps.js";
import { DrawerResizeHandle, useDrawerResize } from "./drawer-resize.js";
import { Icon } from "./icons.js";
import { StepList } from "./step-list.js";
import { selectAdjacentTab } from "./tab-keyboard.js";
import { sessionTitle } from "./technical-details-title.js";
import { TechnicalModelUsage } from "./technical-model-usage.js";
import { TranscriptCopy } from "./transcript-copy.js";

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
  thinkingByStep: Readonly<Record<string, string>>;
  thinkingStepId: string | undefined;
  nativeActionMessage?: string | undefined;
  contextUsedTokens?: number | null;
  contextAllocatedTokens?: number | null;
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

function Overview({
  api,
  catalogPath,
  executions,
  model,
  nativeActionMessage,
  sessionId,
  timeline,
  contextUsedTokens,
  contextAllocatedTokens,
  artifacts,
}: TechnicalDetailsProps) {
  const limits = timeline.find((item) => item.eventType === "run.started")?.text;
  return (
    <div className="technical-details-scroll" role="tabpanel" id="technical-overview-panel">
      {limits === undefined && executions.length === 0 ? (
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
          <TranscriptCopy
            artifacts={artifacts}
            executions={executions}
            nativeActionMessage={nativeActionMessage}
            sessionId={sessionId}
            timeline={timeline}
            title={sessionTitle(timeline, sessionId)}
          />
        </article>
      )}
      <article className="technical-details-item">
        <p>Certified guest capabilities</p>
        <TechnicalModelUsage
          contextAllocatedTokens={contextAllocatedTokens}
          contextUsedTokens={contextUsedTokens}
          model={model}
        />
        {limits === undefined ? null : <p className="technical-limits">{limits}</p>}
        <details>
          <summary>Show tools and runtimes</summary>
          <pre>{guestCapabilities()}</pre>
        </details>
      </article>
    </div>
  );
}

function Steps({
  onSelectStep,
  selectedStepId,
  steps,
  thinkingByStep,
  thinkingStepId,
}: TechnicalDetailsProps) {
  return (
    <div className="technical-details-scroll" id="technical-steps-panel" role="tabpanel">
      <StepList
        onSelectStep={onSelectStep}
        selectedStepId={selectedStepId}
        steps={steps}
        thinkingByStep={thinkingByStep}
        thinkingStepId={thinkingStepId}
      />
    </div>
  );
}

type DrawerTab = "overview" | "steps";
const DRAWER_TABS = ["overview", "steps"] as const;

function DrawerTabs({ active, onSelect }: { active: DrawerTab; onSelect(tab: DrawerTab): void }) {
  return (
    <div aria-label="Technical details sections" className="drawer-tabs" role="tablist">
      {DRAWER_TABS.map((tab) => (
        <button
          aria-controls={`technical-${tab}-panel`}
          aria-selected={active === tab}
          key={tab}
          onClick={() => onSelect(tab)}
          onKeyDown={(event) => selectAdjacentTab(event, tab, DRAWER_TABS, onSelect)}
          role="tab"
          tabIndex={active === tab ? 0 : -1}
          type="button"
        >
          {tab === "overview" ? "Overview" : "Steps"}
        </button>
      ))}
    </div>
  );
}

export function TechnicalDetails(props: TechnicalDetailsProps) {
  const [tab, setTab] = useState<DrawerTab>(
    props.selectedStepId === undefined ? "overview" : "steps",
  );
  const resize = useDrawerResize();
  useEffect(() => {
    if (props.selectedStepId !== undefined) setTab("steps");
  }, [props.selectedStepId]);
  if (!props.open) return null;
  return (
    <aside
      aria-label="Technical details"
      className="technical-details-drawer"
      style={
        resize.width === undefined
          ? undefined
          : ({ "--technical-details-width": `${resize.width}px` } as CSSProperties)
      }
    >
      <DrawerResizeHandle resize={resize} />
      <header className="technical-details-header">
        <div>
          <h2>Technical details</h2>
          <p>Local limits, diagnostics, and execution evidence</p>
        </div>
        <button aria-label="Close technical details" onClick={props.onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      <DrawerTabs active={tab} onSelect={setTab} />
      {tab === "overview" ? <Overview {...props} /> : <Steps {...props} />}
    </aside>
  );
}

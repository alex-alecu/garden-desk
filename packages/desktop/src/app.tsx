import type { AgentRunSummary } from "@gardendesk/shared";
import { useEffect, useReducer, useRef, useState } from "react";
import type { DesktopApi } from "./api.js";
import { useAppearance } from "./appearance.js";
import { artifactActions } from "./artifact-actions.js";
import type { DesktopCapabilities } from "./capabilities.js";
import { AppSidebar } from "./components/app-sidebar.js";
import { ChatHeader } from "./components/chat-header.js";
import { Composer } from "./components/composer.js";
import { ActiveConfirmation, type ConfirmationRequest } from "./components/confirmation.js";
import { Conversation } from "./components/conversation.js";
import { DropOverlay } from "./components/drop-overlay.js";
import { GuidedExamples } from "./components/guided-examples.js";
import { PendingQuestion } from "./components/pending-question.js";
import { SecureWorkspaceBanner } from "./components/secure-workspace-banner.js";
import { SpecialistActions, SpecialistView } from "./components/specialist-view.js";
import { TechnicalDetails } from "./components/technical-details.js";
import { attach, openAttachment, remove, selectSession, send } from "./desktop-actions.js";
import { type DropIntent, useNativeDrop } from "./desktop-drop.js";
import { initialModelStatus, useModelRefresh } from "./desktop-model.js";
import { useDraftPersistence } from "./draft-persistence.js";
import { secureWorkspaceAllowsTasks } from "./secure-workspace.js";
import { type DesktopBootstrapRequest, desktopBootstrapRequest } from "./startup.js";
import { desktopReducer, initialDesktopState } from "./state.js";
import { selectStep } from "./step-selection.js";
import { agentSteps, desktopThinking } from "./steps.js";
import { useChildRun } from "./use-child-run.js";
import { useSecureWorkspace } from "./use-secure-workspace.js";
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single desktop composition boundary.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: single desktop composition boundary.
export function App({ api, capabilities }: { api: DesktopApi; capabilities: DesktopCapabilities }) {
  const appearance = useAppearance();
  const [state, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const [desktopError, setDesktopError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [selectedChild, setSelectedChild] = useState<AgentRunSummary>();
  useEffect(() => {
    setSelectedChild((current) =>
      current?.sessionId === state.activeSessionId ? current : undefined,
    );
  }, [state.activeSessionId]);
  const childOpen =
    selectedChild !== undefined && selectedChild.sessionId === state.activeSessionId;
  const child = useChildRun(api, childOpen ? selectedChild : undefined);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [dropIntent, setDropIntent] = useState<DropIntent>();
  const [model, setModel] = useState(initialModelStatus);
  const bootstrap = useRef<DesktopBootstrapRequest | undefined>(undefined);
  const secureWorkspace = useSecureWorkspace(api, setConfirmation, setDesktopError);
  useEffect(() => {
    bootstrap.current = desktopBootstrapRequest(api, bootstrap.current);
    let active = true;
    void bootstrap.current.promise
      .then((snapshot) => {
        if (!active) return;
        setModel(snapshot.model);
        if (snapshot.model.state === "unsupported" && snapshot.model.message !== undefined)
          setDesktopError(snapshot.model.message);
        dispatch({ type: "desktop.hydrate", snapshot });
        if (snapshot.initialSessionId !== undefined) {
          void selectSession(api, snapshot.initialSessionId, dispatch, setDesktopError);
        }
      })
      .catch(() => {
        if (active) setDesktopError("Garden Desk could not finish loading.");
      });
    return () => {
      active = false;
    };
  }, [api]);
  const nativeUnavailable = capabilities.nativeActions
    ? undefined
    : (capabilities.unavailableReason ?? "Unavailable in the public demo");
  const generatedFileActions = artifactActions(api, state.activeSessionId, setDesktopError);
  const folderName = state.folders.find(
    (folder) =>
      folder.id === state.newSessionFolderId ||
      folder.sessions.some((session) => session.id === state.activeSessionId),
  )?.name;
  const running =
    submitting || state.activeRun?.state === "queued" || state.activeRun?.state === "running";
  useModelRefresh(api, state.loaded, running || model.state === "busy", setModel);
  const sessionLoading = state.pendingSessionId !== undefined;
  const desktopReady = state.loaded && !sessionLoading;
  const tasksAllowed = secureWorkspaceAllowsTasks(secureWorkspace.status);
  const draftPersistence = useDraftPersistence(api, setDesktopError);
  useNativeDrop({
    api,
    context: {
      activeSessionId: state.activeSessionId,
      draft: state.draft,
      newSessionFolderId: state.newSessionFolderId,
      running: running || sessionLoading,
    },
    dispatch,
    enabled: capabilities.nativeActions && !childOpen,
    setDropIntent,
    setError: setDesktopError,
  });
  const runTask = (text: string) => {
    if (!tasksAllowed) {
      setDesktopError("Set up the secure workspace before starting a new task.");
      return;
    }
    draftPersistence.cancel();
    void send({
      api,
      text,
      activeSessionId: state.activeSessionId,
      newSessionFolderId: state.newSessionFolderId,
      dispatch,
      setError: setDesktopError,
      setSubmitting,
    });
  };
  const detailState = childOpen ? child.state : state;
  const detailDispatch = childOpen ? child.dispatch : dispatch;
  const steps = agentSteps(detailState.timeline, detailState.executions, detailState.traces);
  const { thinkingByStep, thinkingStepId } = desktopThinking(detailState);
  const cancelTask = () => {
    if (state.activeRun !== undefined) {
      void api
        .cancelAgent(state.activeRun.jobId)
        .catch(() => setDesktopError("The task could not be cancelled."));
    }
  };
  const closeChild = () => {
    const id = selectedChild?.id;
    setSelectedChild(undefined);
    setTechnicalDetailsOpen(false);
    requestAnimationFrame(() =>
      document.getElementById(`specialist-run-${id}`)?.focus({ preventScroll: true }),
    );
  };
  const onSelectStep = (stepId: string | undefined) =>
    selectStep(
      {
        api,
        dispatch: detailDispatch,
        openDetails: () => setTechnicalDetailsOpen(true),
        setError: setDesktopError,
        steps,
      },
      stepId,
    );
  return (
    <div
      className="app-shell"
      data-appearance={appearance.preference}
      data-theme={appearance.resolved}
    >
      <AppSidebar
        api={api}
        dispatch={dispatch}
        dropIntent={dropIntent}
        nativeActionMessage={nativeUnavailable}
        setConfirmation={setConfirmation}
        setError={setDesktopError}
        state={state}
      />
      <main aria-busy={!desktopReady} className="workspace">
        <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region="" />
        <ChatHeader
          appearance={appearance.preference}
          technicalDetailsOpen={technicalDetailsOpen}
          model={model}
          specialistAgentId={childOpen ? selectedChild.agentId : undefined}
          nativeActionMessage={nativeUnavailable}
          onAppearanceChange={appearance.cycle}
          onTechnicalDetailsOpen={() => {
            detailDispatch({ type: "step.select", stepId: undefined });
            setTechnicalDetailsOpen(true);
          }}
          onUnload={() => {
            void api
              .unloadModel()
              .then(async (unloaded) => {
                if (!unloaded)
                  setDesktopError("The model is still in use and could not be unloaded.");
                setModel(await api.getModelStatus());
              })
              .catch(() => setDesktopError("The model could not be unloaded."));
          }}
        />
        <SecureWorkspaceBanner
          busy={secureWorkspace.busy}
          onSetup={secureWorkspace.showSetup}
          status={secureWorkspace.status}
        />
        <GuidedExamples
          disabled={!desktopReady || running || !tasksAllowed}
          examples={capabilities.guidedExamples ?? []}
          onRun={runTask}
        />
        {desktopError === undefined ? null : (
          <div className="error-banner" role="alert">
            <span>{desktopError}</span>
            <button
              aria-label="Dismiss error"
              onClick={() => setDesktopError(undefined)}
              type="button"
            >
              ×
            </button>
          </div>
        )}
        <Conversation
          hidden={childOpen}
          childRuns={state.childRuns}
          onOpenChild={(run) => {
            dispatch({
              type: "step.select",
              stepId: state.timeline.find(
                (item) =>
                  item.runId === run.parentRunId && item.toolCallId === run.parentToolCallId,
              )?.id,
            });
            setSelectedChild(run);
            setTechnicalDetailsOpen(false);
          }}
          artifacts={state.artifacts}
          attachments={state.attachments}
          folderName={folderName}
          key={state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`}
          nativeActionMessage={nativeUnavailable}
          ready={state.loaded}
          onOpenAttachment={(attachmentId) => {
            if (state.activeSessionId !== undefined) {
              void openAttachment(api, state.activeSessionId, attachmentId, setDesktopError);
            }
          }}
          onSuggestion={(draft) => {
            dispatch({ type: "draft.change", draft });
            draftPersistence.schedule(state.activeSessionId, draft);
          }}
          {...generatedFileActions}
          onSelectStep={onSelectStep}
          selectedStepId={state.selectedStepId}
          timeline={state.timeline}
          performance={state.activeRun?.performance ?? null}
          runId={state.activeRun?.id}
          thinkingByStep={desktopThinking(state).thinkingByStep}
          working={state.activeRun?.state === "queued" || state.activeRun?.state === "running"}
          activeRunState={state.activeRun?.state}
        />
        {childOpen ? (
          <SpecialistView
            key={selectedChild.id}
            run={selectedChild}
            state={child.state}
            unavailable={child.unavailable}
            onSelectStep={onSelectStep}
          />
        ) : null}
        {childOpen ? (
          <SpecialistActions
            needsAnswer={state.question !== null}
            running={running}
            onBack={closeChild}
            onCancel={cancelTask}
          />
        ) : state.question !== null ? (
          <PendingQuestion
            api={api}
            request={state.question}
            run={state.activeRun}
            setError={setDesktopError}
          />
        ) : (
          <Composer
            key={`composer:${state.activeSessionId ?? "new"}`}
            commands={state.commands}
            attachments={state.attachments.filter((attachment) =>
              state.removableAttachmentIds.includes(attachment.id),
            )}
            dropActive={dropIntent === "files" || dropIntent === "mixed"}
            draft={state.draft}
            disabled={!desktopReady || model.state === "unsupported" || !tasksAllowed}
            nativeActionMessage={nativeUnavailable}
            onAttach={() =>
              void attach({
                api,
                activeSessionId: state.activeSessionId,
                newSessionFolderId: state.newSessionFolderId,
                dispatch,
                draft: state.draft,
                setError: setDesktopError,
              })
            }
            onCancel={cancelTask}
            onChange={(draft) => {
              dispatch({ type: "draft.change", draft });
              draftPersistence.schedule(state.activeSessionId, draft);
            }}
            onOpenAttachment={(attachmentId) => {
              if (state.activeSessionId !== undefined)
                void openAttachment(api, state.activeSessionId, attachmentId, setDesktopError);
            }}
            onRemoveAttachment={(attachmentId) => {
              if (state.activeSessionId !== undefined) {
                const attachmentName = state.attachments.find(
                  (attachment) => attachment.id === attachmentId,
                )?.name;
                const sessionId = state.activeSessionId;
                setConfirmation({
                  title: `Remove “${attachmentName ?? "this attachment"}”?`,
                  description:
                    "This removes the attachment from the conversation. The original file on your computer is unchanged.",
                  confirmLabel: "Remove attachment",
                  onConfirm: () =>
                    void remove({
                      api,
                      sessionId,
                      attachmentId,
                      dispatch,
                      setError: setDesktopError,
                    }),
                });
              }
            }}
            onSend={runTask}
            removableAttachmentIds={state.removableAttachmentIds}
            running={running}
          />
        )}
      </main>
      <TechnicalDetails
        artifacts={detailState.artifacts}
        catalogPath={state.catalogPath}
        executions={detailState.executions}
        key={`${childOpen ? selectedChild.id : (state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`)}:${technicalDetailsOpen ? "open" : "closed"}`}
        api={api}
        model={model}
        nativeActionMessage={nativeUnavailable}
        onClose={() => setTechnicalDetailsOpen(false)}
        open={technicalDetailsOpen}
        onSelectStep={onSelectStep}
        contextUsedTokens={detailState.contextUsedTokens}
        contextAllocatedTokens={detailState.contextAllocatedTokens}
        selectedStepId={detailState.selectedStepId}
        sessionId={state.activeSessionId}
        steps={steps}
        thinkingByStep={thinkingByStep}
        thinkingStepId={thinkingStepId}
        timeline={detailState.timeline}
      />
      <ActiveConfirmation clear={() => setConfirmation(undefined)} request={confirmation} />
      <DropOverlay intent={dropIntent} />
    </div>
  );
}

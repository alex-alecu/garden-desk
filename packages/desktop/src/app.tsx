import { useEffect, useReducer, useState } from "react";
import type { DesktopApi } from "./api.js";
import { useAppearance } from "./appearance.js";
import type { DesktopCapabilities } from "./capabilities.js";
import { AppSidebar } from "./components/app-sidebar.js";
import { ChatHeader } from "./components/chat-header.js";
import { Composer } from "./components/composer.js";
import { Confirmation, type ConfirmationRequest } from "./components/confirmation.js";
import { Conversation } from "./components/conversation.js";
import { DropOverlay } from "./components/drop-overlay.js";
import { GuidedExamples } from "./components/guided-examples.js";
import { TechnicalDetails } from "./components/technical-details.js";
import { useContinuationQuestion } from "./continuation.js";
import { attach, openAttachment, remove, selectSession, send } from "./desktop-actions.js";
import { type DropIntent, useNativeDrop } from "./desktop-drop.js";
import { initialModelStatus, useModelRefresh } from "./desktop-model.js";
import { useDraftPersistence } from "./draft-persistence.js";
import { desktopReducer, initialDesktopState } from "./state.js";
import { selectStep } from "./step-selection.js";
import { activeThinkingStepId, agentSteps } from "./steps.js";
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the single view-composition boundary for explicit desktop capabilities.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: this is the single view-composition boundary; workflow logic remains in the small helpers above.
export function App({ api, capabilities }: { api: DesktopApi; capabilities: DesktopCapabilities }) {
  const appearance = useAppearance();
  const [state, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const [desktopError, setDesktopError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [dropIntent, setDropIntent] = useState<DropIntent>();
  const [model, setModel] = useState(initialModelStatus);
  useEffect(() => {
    void api
      .bootstrapDesktop()
      .then((snapshot) => {
        setModel(snapshot.model);
        if (snapshot.model.state === "unsupported" && snapshot.model.message !== undefined) {
          setDesktopError(snapshot.model.message);
        }
        dispatch({ type: "desktop.hydrate", snapshot });
        if (snapshot.initialSessionId !== undefined) {
          void selectSession(api, snapshot.initialSessionId, dispatch, setDesktopError);
        }
      })
      .catch(() => setDesktopError("Vault Core could not be started."));
  }, [api]);
  useModelRefresh(api, state.loaded, state.activeRun?.state, setModel);
  const nativeUnavailable = capabilities.nativeActions
    ? undefined
    : (capabilities.unavailableReason ?? "Unavailable in the public demo");
  const folderName = state.folders.find(
    (folder) =>
      folder.id === state.newSessionFolderId ||
      folder.sessions.some((session) => session.id === state.activeSessionId),
  )?.name;
  const running =
    submitting || state.activeRun?.state === "queued" || state.activeRun?.state === "running";
  const draftPersistence = useDraftPersistence(api, setDesktopError);
  useNativeDrop({
    api,
    context: {
      activeSessionId: state.activeSessionId,
      draft: state.draft,
      newSessionFolderId: state.newSessionFolderId,
      running,
    },
    dispatch,
    enabled: capabilities.nativeActions,
    setDropIntent,
    setError: setDesktopError,
  });
  const runTask = (text: string) => {
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
  const steps = agentSteps(state.timeline, state.executions, state.traces);
  const thinkingStepId = activeThinkingStepId(state.timeline, state.activeRun?.id, state.thinking);
  const onSelectStep = (stepId: string | undefined) =>
    selectStep(
      {
        api,
        dispatch,
        openDetails: () => setTechnicalDetailsOpen(true),
        setError: setDesktopError,
        steps,
      },
      stepId,
    );
  const continuationProps = useContinuationQuestion(state.activeRun, state.executions, runTask);
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
      <main aria-busy={!state.loaded} className="workspace">
        <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region="" />
        <ChatHeader
          appearance={appearance.preference}
          technicalDetailsOpen={technicalDetailsOpen}
          model={model}
          nativeActionMessage={nativeUnavailable}
          onAppearanceChange={appearance.cycle}
          onTechnicalDetailsOpen={() => {
            dispatch({ type: "step.select", stepId: undefined });
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
        <GuidedExamples
          disabled={!state.loaded || running}
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
          artifacts={state.artifacts}
          attachments={state.attachments}
          folderName={folderName}
          key={state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`}
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
          onSelectStep={onSelectStep}
          selectedStepId={state.selectedStepId}
          timeline={state.timeline}
          performance={state.activeRun?.performance ?? null}
          runId={state.activeRun?.id}
          thinking={state.thinking}
          working={state.activeRun?.state === "queued" || state.activeRun?.state === "running"}
          {...continuationProps}
        />
        <Composer
          attachments={state.attachments.filter((attachment) =>
            state.removableAttachmentIds.includes(attachment.id),
          )}
          dropActive={dropIntent === "files" || dropIntent === "mixed"}
          draft={state.draft}
          disabled={!state.loaded || model.state === "unsupported"}
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
          onCancel={() => {
            if (state.activeRun !== undefined) {
              void api
                .cancelAgent(state.activeRun.jobId)
                .catch(() => setDesktopError("The task could not be cancelled."));
            }
          }}
          onChange={(draft) => {
            dispatch({ type: "draft.change", draft });
            draftPersistence.schedule(state.activeSessionId, draft);
          }}
          onOpenAttachment={(attachmentId) => {
            if (state.activeSessionId !== undefined) {
              void openAttachment(api, state.activeSessionId, attachmentId, setDesktopError);
            }
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
      </main>
      <TechnicalDetails
        artifacts={state.artifacts}
        catalogPath={state.catalogPath}
        executions={state.executions}
        key={`${state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`}:${technicalDetailsOpen ? "open" : "closed"}`}
        api={api}
        model={model}
        nativeActionMessage={nativeUnavailable}
        onClose={() => setTechnicalDetailsOpen(false)}
        open={technicalDetailsOpen}
        onSelectStep={onSelectStep}
        selectedStepId={state.selectedStepId}
        sessionId={state.activeSessionId}
        steps={steps}
        thinking={state.thinking}
        thinkingStepId={thinkingStepId}
        timeline={state.timeline}
      />
      <Confirmation
        onCancel={() => setConfirmation(undefined)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(undefined);
          action?.();
        }}
        request={confirmation}
      />
      <DropOverlay intent={dropIntent} />
    </div>
  );
}

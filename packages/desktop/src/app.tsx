import type { ModelRuntimeStatus } from "@vault/shared";
import { useEffect, useReducer, useState } from "react";
import type { DesktopApi } from "./api.js";
import { useAppearance } from "./appearance.js";
import type { DesktopCapabilities } from "./capabilities.js";
import { ChatHeader } from "./components/chat-header.js";
import { Composer } from "./components/composer.js";
import { Confirmation } from "./components/confirmation.js";
import { Conversation } from "./components/conversation.js";
import { GuidedExamples } from "./components/guided-examples.js";
import { Sidebar } from "./components/sidebar.js";
import { TechnicalDetails } from "./components/technical-details.js";
import {
  addFolder,
  attach,
  changeDraft,
  deleteConversation,
  remove,
  selectSession,
  send,
  showFolder,
  showMore,
} from "./desktop-actions.js";
import { desktopReducer, initialDesktopState } from "./state.js";

interface ConfirmationRequest {
  confirmLabel: string;
  description: string;
  title: string;
  onConfirm(): void;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the single view-composition boundary for explicit desktop capabilities.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: this is the single view-composition boundary; workflow logic remains in the small helpers above.
export function App({ api, capabilities }: { api: DesktopApi; capabilities: DesktopCapabilities }) {
  const appearance = useAppearance();
  const [state, dispatch] = useReducer(desktopReducer, initialDesktopState);
  const [desktopError, setDesktopError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest>();
  const [model, setModel] = useState<ModelRuntimeStatus>({
    modelId: "gemma-4-12b-it-qat-q4_0",
    name: "Gemma 4 12B QAT",
    state: "unloaded",
    thinkingSupported: true,
  });
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
  useEffect(() => {
    if (!state.loaded) return;
    const running = state.activeRun?.state === "queued" || state.activeRun?.state === "running";
    const refresh = () =>
      void api
        .getModelStatus()
        .then(setModel)
        .catch(() => undefined);
    refresh();
    if (!running) return;
    const timer = window.setInterval(refresh, 700);
    return () => window.clearInterval(timer);
  }, [api, state.activeRun?.state, state.loaded]);
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
  const runTask = (text: string) =>
    void send({
      api,
      text,
      activeSessionId: state.activeSessionId,
      newSessionFolderId: state.newSessionFolderId,
      dispatch,
      setError: setDesktopError,
      setSubmitting,
    });
  return (
    <div
      className="app-shell"
      data-appearance={appearance.preference}
      data-theme={appearance.resolved}
    >
      <Sidebar
        activeSessionId={state.activeSessionId}
        disabled={!state.loaded}
        dispatch={dispatch}
        folders={state.folders}
        globalSessions={state.globalSessions}
        workingSessionIds={state.workingSessionIds}
        nativeActionMessage={nativeUnavailable}
        onAddFolder={() => void addFolder(api, dispatch, setDesktopError)}
        onNewSession={(folderId) => dispatch({ type: "session.new", folderId })}
        onOpenFolder={(folderId) => void showFolder(api, folderId, setDesktopError)}
        onDeleteSession={(session) =>
          setConfirmation({
            title: `Delete “${session.title}”?`,
            description:
              "This permanently removes the conversation, its activity, and its generated-file records. This cannot be undone.",
            confirmLabel: "Delete conversation",
            onConfirm: () => void deleteConversation(api, session.id, dispatch, setDesktopError),
          })
        }
        onRevokeFolder={(folderId) => {
          const folderName = state.folders.find((folder) => folder.id === folderId)?.name;
          setConfirmation({
            title: `Unmount “${folderName ?? "this folder"}”?`,
            description:
              "Vault Desk will unmount this folder and remove its access grant. Files on your computer and existing conversation history are not deleted.",
            confirmLabel: "Unmount folder",
            onConfirm: () => {
              void api
                .revokeFolder(folderId)
                .then((revoked) => {
                  if (revoked) dispatch({ type: "folder.revoked", folderId });
                })
                .catch(() => setDesktopError("The folder could not be unmounted."));
            },
          });
        }}
        onSelectSession={(sessionId) =>
          void selectSession(api, sessionId, dispatch, setDesktopError)
        }
        onShowMore={(folderId) =>
          void showMore({
            api,
            folderId,
            cursor: state.folders.find((folder) => folder.id === folderId)?.nextCursor ?? null,
            dispatch,
            setError: setDesktopError,
          })
        }
      />
      <main aria-busy={!state.loaded} className="workspace">
        <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region="" />
        <ChatHeader
          appearance={appearance.preference}
          technicalDetailsOpen={technicalDetailsOpen}
          model={model}
          nativeActionMessage={nativeUnavailable}
          onAppearanceChange={appearance.cycle}
          onTechnicalDetailsOpen={() => setTechnicalDetailsOpen(true)}
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
          folderName={folderName}
          key={state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`}
          ready={state.loaded}
          onSuggestion={(draft) =>
            changeDraft({
              api,
              draft,
              sessionId: state.activeSessionId,
              dispatch,
              setError: setDesktopError,
            })
          }
          timeline={state.timeline}
          performance={state.activeRun?.performance ?? null}
          runId={state.activeRun?.id}
          thinking={state.thinking}
        />
        <Composer
          attachments={state.attachments}
          draft={state.draft}
          disabled={!state.loaded || model.state === "unsupported"}
          nativeActionMessage={nativeUnavailable}
          onAttach={() =>
            void attach({
              api,
              activeSessionId: state.activeSessionId,
              newSessionFolderId: state.newSessionFolderId,
              dispatch,
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
          onChange={(draft) =>
            changeDraft({
              api,
              draft,
              sessionId: state.activeSessionId,
              dispatch,
              setError: setDesktopError,
            })
          }
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
        sessionId={state.activeSessionId}
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
    </div>
  );
}

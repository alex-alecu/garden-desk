import type { ModelRuntimeStatus } from "@vault/shared";
import { useEffect, useReducer, useState } from "react";
import { bootstrapDesktop, cancelAgent, getModelStatus, revokeFolder, unloadModel } from "./api.js";
import { ChatHeader } from "./components/chat-header.js";
import { Composer } from "./components/composer.js";
import { Confirmation } from "./components/confirmation.js";
import { Conversation } from "./components/conversation.js";
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

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: this is the single view-composition boundary; workflow logic remains in the small helpers above.
export function App() {
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
    void bootstrapDesktop()
      .then((snapshot) => {
        setModel(snapshot.model);
        if (snapshot.model.state === "unsupported" && snapshot.model.message !== undefined) {
          setDesktopError(snapshot.model.message);
        }
        dispatch({ type: "desktop.hydrate", snapshot });
      })
      .catch(() => setDesktopError("Vault Core could not be started."));
  }, []);
  useEffect(() => {
    if (!state.loaded) return;
    const running = state.activeRun?.state === "queued" || state.activeRun?.state === "running";
    const refresh = () =>
      void getModelStatus()
        .then(setModel)
        .catch(() => undefined);
    refresh();
    if (!running) return;
    const timer = window.setInterval(refresh, 700);
    return () => window.clearInterval(timer);
  }, [state.activeRun?.state, state.loaded]);
  const folderName = state.folders.find(
    (folder) =>
      folder.id === state.newSessionFolderId ||
      folder.sessions.some((session) => session.id === state.activeSessionId),
  )?.name;
  return (
    <div className="app-shell">
      <Sidebar
        activeSessionId={state.activeSessionId}
        disabled={!state.loaded}
        dispatch={dispatch}
        folders={state.folders}
        globalSessions={state.globalSessions}
        onAddFolder={() => void addFolder(dispatch, setDesktopError)}
        onNewSession={(folderId) => dispatch({ type: "session.new", folderId })}
        onOpenFolder={(folderId) => void showFolder(folderId, setDesktopError)}
        onDeleteSession={(session) =>
          setConfirmation({
            title: `Delete “${session.title}”?`,
            description:
              "This permanently removes the conversation, its activity, and its generated-file records. This cannot be undone.",
            confirmLabel: "Delete conversation",
            onConfirm: () => void deleteConversation(session.id, dispatch, setDesktopError),
          })
        }
        onRevokeFolder={(folderId) => {
          const folderName = state.folders.find((folder) => folder.id === folderId)?.name;
          setConfirmation({
            title: `Remove “${folderName ?? "this folder"}”?`,
            description:
              "Vault Desk will remove access to this folder. Files on your computer and existing conversation history are not deleted.",
            confirmLabel: "Remove folder",
            onConfirm: () => {
              void revokeFolder(folderId)
                .then((revoked) => {
                  if (revoked) dispatch({ type: "folder.revoked", folderId });
                })
                .catch(() => setDesktopError("The folder grant could not be removed."));
            },
          });
        }}
        onSelectSession={(sessionId) => void selectSession(sessionId, dispatch, setDesktopError)}
        onShowMore={(folderId) =>
          void showMore(
            folderId,
            state.folders.find((folder) => folder.id === folderId)?.nextCursor ?? null,
            dispatch,
            setDesktopError,
          )
        }
      />
      <main aria-busy={!state.loaded} className="workspace">
        <div aria-hidden="true" className="window-drag-region" data-tauri-drag-region="" />
        <ChatHeader
          technicalDetailsOpen={technicalDetailsOpen}
          model={model}
          onTechnicalDetailsOpen={() => setTechnicalDetailsOpen(true)}
          onUnload={() => {
            void unloadModel()
              .then(async (unloaded) => {
                if (!unloaded)
                  setDesktopError("The model is still in use and could not be unloaded.");
                setModel(await getModelStatus());
              })
              .catch(() => setDesktopError("The model could not be unloaded."));
          }}
        />
        <TechnicalDetails
          artifacts={state.artifacts}
          catalogPath={state.catalogPath}
          executions={state.executions}
          key={`${state.activeSessionId ?? `new:${state.newSessionFolderId ?? "global"}`}:${technicalDetailsOpen ? "open" : "closed"}`}
          onClose={() => setTechnicalDetailsOpen(false)}
          open={technicalDetailsOpen}
          sessionId={state.activeSessionId}
          timeline={state.timeline}
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
            changeDraft(draft, state.activeSessionId, dispatch, setDesktopError)
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
          onAttach={() =>
            void attach(state.activeSessionId, state.newSessionFolderId, dispatch, setDesktopError)
          }
          onCancel={() => {
            if (state.activeRun !== undefined) {
              void cancelAgent(state.activeRun.jobId).catch(() =>
                setDesktopError("The task could not be cancelled."),
              );
            }
          }}
          onChange={(draft) => changeDraft(draft, state.activeSessionId, dispatch, setDesktopError)}
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
                onConfirm: () => void remove(sessionId, attachmentId, dispatch, setDesktopError),
              });
            }
          }}
          onSend={(text) =>
            void send({
              text,
              activeSessionId: state.activeSessionId,
              newSessionFolderId: state.newSessionFolderId,
              dispatch,
              setError: setDesktopError,
              setSubmitting,
            })
          }
          removableAttachmentIds={state.removableAttachmentIds}
          running={
            submitting ||
            state.activeRun?.state === "queued" ||
            state.activeRun?.state === "running"
          }
        />
      </main>
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

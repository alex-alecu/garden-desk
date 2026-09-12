import type { DesktopApi } from "../api.js";
import { attach, openAttachment, remove } from "../desktop-actions.js";
import type { DropIntent } from "../desktop-drop.js";
import type { DesktopAction, DesktopState } from "../state.js";
import { Composer } from "./composer.js";
import type { ConfirmationRequest } from "./confirmation.js";
import { PendingQuestion } from "./pending-question.js";
import { SpecialistActions } from "./specialist-view.js";

interface AppChatControlsProps {
  api: DesktopApi;
  childOpen: boolean;
  onBack(): void;
  disabled: boolean;
  dispatch(action: DesktopAction): void;
  dropIntent: DropIntent | undefined;
  nativeActionMessage: string | undefined;
  onCancel(): void;
  onChange(draft: string): void;
  onSend(text: string): void;
  running: boolean;
  setConfirmation(request: ConfirmationRequest): void;
  setError(message: string | undefined): void;
  state: DesktopState;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one chat control boundary; actions live in desktop-actions.
export function AppChatControls({
  api,
  childOpen,
  onBack,
  disabled,
  dispatch,
  dropIntent,
  nativeActionMessage,
  onCancel,
  onChange,
  onSend,
  running,
  setConfirmation,
  setError,
  state,
}: AppChatControlsProps) {
  if (childOpen) {
    return (
      <SpecialistActions
        needsAnswer={state.question !== null}
        running={running}
        onBack={onBack}
        onCancel={onCancel}
      />
    );
  }
  if (state.question !== null) {
    return (
      <PendingQuestion
        api={api}
        request={state.question}
        run={state.activeRun}
        setError={setError}
      />
    );
  }
  return (
    <Composer
      key={`composer:${state.activeSessionId ?? "new"}`}
      commands={state.commands}
      attachments={state.attachments.filter((attachment) =>
        state.removableAttachmentIds.includes(attachment.id),
      )}
      dropActive={dropIntent === "files" || dropIntent === "mixed"}
      draft={state.draft}
      disabled={disabled}
      nativeActionMessage={nativeActionMessage}
      onAttach={() =>
        void attach({
          api,
          activeSessionId: state.activeSessionId,
          newSessionFolderId: state.newSessionFolderId,
          dispatch,
          draft: state.draft,
          setError,
        })
      }
      onCancel={onCancel}
      onChange={onChange}
      onOpenAttachment={(attachmentId) => {
        if (state.activeSessionId !== undefined)
          void openAttachment(api, state.activeSessionId, attachmentId, setError);
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
                setError,
              }),
          });
        }
      }}
      onSend={onSend}
      removableAttachmentIds={state.removableAttachmentIds}
      running={running}
    />
  );
}

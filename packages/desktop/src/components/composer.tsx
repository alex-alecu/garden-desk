import type { AttachmentSummary } from "@vault/shared";
import type { FormEvent, KeyboardEvent } from "react";
import { Icon } from "./icons.js";

interface ComposerProps {
  attachments: AttachmentSummary[];
  disabled: boolean;
  draft: string;
  nativeActionMessage?: string | undefined;
  removableAttachmentIds: string[];
  running: boolean;
  onAttach(): void;
  onCancel(): void;
  onChange(draft: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onSend(text: string): void;
}

export function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, canSend: boolean) {
  if (!canSend || event.key !== "Enter" || !event.metaKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function AttachmentList({
  attachments,
  nativeActionMessage,
  removableAttachmentIds,
  onRemoveAttachment,
}: Pick<
  ComposerProps,
  "attachments" | "nativeActionMessage" | "removableAttachmentIds" | "onRemoveAttachment"
>) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="attachment-list">
      {attachments.map((item) => (
        <li className="attachment-chip" key={item.id}>
          <span>{item.name}</span>
          {removableAttachmentIds.includes(item.id) ? (
            <button
              aria-label={`Remove ${item.name}`}
              disabled={nativeActionMessage !== undefined}
              onClick={() => onRemoveAttachment(item.id)}
              title={nativeActionMessage}
              type="button"
            >
              ×
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one compact form keeps composer state and accessibility relationships visible.
export function Composer({
  attachments,
  disabled,
  draft,
  nativeActionMessage,
  removableAttachmentIds,
  running,
  onAttach,
  onCancel,
  onChange,
  onRemoveAttachment,
  onSend,
}: ComposerProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (text.length > 0) onSend(text);
  }

  const canSend = !disabled && !running && draft.trim().length > 0;

  return (
    <form className="composer" onSubmit={submit}>
      <AttachmentList
        attachments={attachments}
        nativeActionMessage={nativeActionMessage}
        onRemoveAttachment={onRemoveAttachment}
        removableAttachmentIds={removableAttachmentIds}
      />
      <textarea
        aria-keyshortcuts="Meta+Enter"
        aria-label="Message"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => handleComposerKeyDown(event, canSend)}
        placeholder="Ask Vault Desk to do anything"
        rows={2}
        value={draft}
      />
      <div className="composer-actions">
        <button
          aria-label="Attach files"
          className="icon-button"
          disabled={disabled || running || nativeActionMessage !== undefined}
          onClick={onAttach}
          title={nativeActionMessage}
          type="button"
        >
          <Icon name="add" />
        </button>
        {running ? (
          <button
            aria-label="Cancel task"
            className="stop-button"
            disabled={disabled}
            onClick={onCancel}
            type="button"
          >
            Stop
          </button>
        ) : (
          <button
            aria-label="Send message"
            className="send-button"
            disabled={!canSend}
            type="submit"
          >
            <Icon name="send" />
          </button>
        )}
      </div>
    </form>
  );
}

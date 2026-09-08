import type { AttachmentSummary, CommandSummary } from "@gardendesk/shared";
import { type FormEvent, type KeyboardEvent, useEffect, useLayoutEffect, useRef } from "react";
import { AttachmentChip } from "./attachment-chip.js";
import { CommandMenu, useCommandMenu } from "./command-menu.js";
import { Icon } from "./icons.js";

interface ComposerProps {
  commands: CommandSummary[];
  attachments: AttachmentSummary[];
  disabled: boolean;
  dropActive?: boolean;
  draft: string;
  nativeActionMessage?: string | undefined;
  removableAttachmentIds: string[];
  running: boolean;
  onAttach(): void;
  onCancel(): void;
  onChange(draft: string): void;
  onOpenAttachment(attachmentId: string): void;
  onRemoveAttachment(attachmentId: string): void;
  onSend(text: string): void;
}

export const COMPOSER_MAX_ROWS = 10;

export function composerHeightLimit(
  lineHeight: number,
  verticalPadding: number,
  viewportHeight: number,
): number {
  return Math.min(COMPOSER_MAX_ROWS * lineHeight + verticalPadding, viewportHeight * 0.25);
}

export function resizeComposerTextarea(
  textarea: HTMLTextAreaElement,
  viewportHeight = window.innerHeight,
): void {
  textarea.style.height = "auto";
  const style = getComputedStyle(textarea);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const verticalPadding =
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const maximum = composerHeightLimit(lineHeight, verticalPadding, viewportHeight);
  const height = Math.min(textarea.scrollHeight, maximum);
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > maximum ? "auto" : "hidden";
}

export function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, canSend: boolean) {
  if (!canSend || event.key !== "Enter" || !event.metaKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function AttachmentList({
  attachments,
  nativeActionMessage,
  onOpenAttachment,
  removableAttachmentIds,
  onRemoveAttachment,
}: Pick<
  ComposerProps,
  | "attachments"
  | "nativeActionMessage"
  | "onOpenAttachment"
  | "removableAttachmentIds"
  | "onRemoveAttachment"
>) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="attachment-list">
      {attachments.map((item) => (
        <AttachmentChip
          attachment={item}
          disabled={nativeActionMessage !== undefined}
          key={item.id}
          onOpen={() => onOpenAttachment(item.id)}
          onRemove={
            removableAttachmentIds.includes(item.id) ? () => onRemoveAttachment(item.id) : undefined
          }
        />
      ))}
    </ul>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: one compact form keeps composer state and accessibility relationships visible.
export function Composer({
  commands,
  attachments,
  disabled,
  dropActive = false,
  draft,
  nativeActionMessage,
  removableAttachmentIds,
  running,
  onAttach,
  onCancel,
  onChange,
  onOpenAttachment,
  onRemoveAttachment,
  onSend,
}: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useCommandMenu({
    commands,
    draft,
    enabled: !disabled && !running,
    textarea,
    onChange,
  });
  useLayoutEffect(() => {
    if (textarea.current !== null) resizeComposerTextarea(textarea.current);
  });
  useEffect(() => {
    const resize = () => {
      if (textarea.current !== null) resizeComposerTextarea(textarea.current);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (text.length > 0) onSend(text);
  }

  const canSend = !disabled && !running && draft.trim().length > 0;

  return (
    <form
      className={`composer${dropActive ? " composer-drop-active" : ""}`}
      data-drop-target="files"
      onSubmit={submit}
    >
      <CommandMenu menu={menu} />
      <AttachmentList
        attachments={attachments}
        nativeActionMessage={nativeActionMessage}
        onOpenAttachment={onOpenAttachment}
        onRemoveAttachment={onRemoveAttachment}
        removableAttachmentIds={removableAttachmentIds}
      />
      <textarea
        aria-keyshortcuts="Meta+Enter"
        aria-label="Message"
        disabled={disabled}
        aria-autocomplete="list"
        aria-controls={menu.open ? menu.id : undefined}
        aria-activedescendant={
          menu.open && menu.matches.length > 0 ? `${menu.id}-${menu.selected}` : undefined
        }
        onFocus={menu.onFocus}
        onBlur={menu.onBlur}
        onSelect={(event) => menu.onSelect(event.currentTarget.selectionStart)}
        onChange={(event) => menu.onChange(event.target.value, event.target.selectionStart)}
        onKeyDown={(event) => {
          if (!menu.onKeyDown(event)) handleComposerKeyDown(event, canSend);
        }}
        placeholder="Ask Garden Desk to do anything, or type / for commands"
        ref={textarea}
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

import type { AttachmentSummary } from "@gardendesk/shared";
import { useEffect, useRef, useState } from "react";
import type { TimelineItem } from "../state.js";
import { Icon } from "./icons.js";
import { MessageAttachments } from "./message-attachments.js";

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatMessageTime(createdAt: string): string {
  return messageTimeFormatter.format(new Date(createdAt));
}

export async function copyUserMessage(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<void> {
  if (clipboard === undefined) throw new Error("clipboard_unavailable");
  await clipboard.writeText(text);
}

export function UserMessage({
  attachments,
  item,
  onOpenAttachment,
}: {
  attachments: AttachmentSummary[];
  item: TimelineItem;
  onOpenAttachment(attachmentId: string): void;
}) {
  const [copyState, setCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );
  const copy = async () => {
    try {
      await copyUserMessage(item.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 2_000);
  };
  const label = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy";
  return (
    <div className="user-message">
      <article className="timeline-item timeline-user">
        <p>{item.text}</p>
        <MessageAttachments attachments={attachments} onOpenAttachment={onOpenAttachment} />
      </article>
      <footer className="user-message-actions">
        <time dateTime={item.createdAt}>{formatMessageTime(item.createdAt)}</time>
        <button aria-label={`${label} message`} onClick={copy} title={label} type="button">
          <Icon name="copy" />
          <span aria-live="polite">{copyState === "idle" ? "" : label}</span>
        </button>
      </footer>
    </div>
  );
}

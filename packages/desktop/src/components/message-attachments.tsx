import type { AttachmentSummary } from "@gardendesk/shared";
import type { TimelineItem } from "../state.js";
import { AttachmentChip } from "./attachment-chip.js";

export function MessageAttachments({
  attachments,
  onOpenAttachment,
}: {
  attachments: AttachmentSummary[];
  onOpenAttachment(attachmentId: string): void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="Message attachments" className="attachment-list conversation-attachments">
      {attachments.map((attachment) => (
        <AttachmentChip
          attachment={attachment}
          key={attachment.id}
          onOpen={() => onOpenAttachment(attachment.id)}
        />
      ))}
    </ul>
  );
}

export function attachmentsByUserMessage(
  timeline: TimelineItem[],
  attachments: AttachmentSummary[],
): Map<string, AttachmentSummary[]> {
  const userMessages = timeline
    .filter((item) => item.kind === "user")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const result = new Map<string, AttachmentSummary[]>();
  for (const attachment of attachments) {
    const message = userMessages.find((item) => item.createdAt >= attachment.createdAt);
    if (message === undefined) continue;
    result.set(message.id, [...(result.get(message.id) ?? []), attachment]);
  }
  return result;
}

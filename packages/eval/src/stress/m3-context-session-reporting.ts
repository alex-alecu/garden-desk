import { ChatMessageSchema } from "@vault/shared";

const ANCHORED_SUMMARY_HEADING = "Anchored summary of earlier turns:\n";
const SUMMARY_ENDINGS = [
  "\nOlder execution summary:",
  "\nNewest unsuperseded failed execution:",
  "\nRecent conversation:",
];

function summaryFrom(text: string, start: number): string {
  const contentStart = start + ANCHORED_SUMMARY_HEADING.length;
  const endings = SUMMARY_ENDINGS.map((marker) => text.indexOf(marker, contentStart)).filter(
    (index) => index !== -1,
  );
  const end = endings.length === 0 ? text.length : Math.min(...endings);
  return text.slice(contentStart, end).trim();
}

export function anchoredSummaryFromTracePrompt(prompt: string): string | undefined {
  const messages = ChatMessageSchema.array().parse(JSON.parse(prompt));
  const message = messages.find(
    (item) => item.role === "user" && item.text.includes(ANCHORED_SUMMARY_HEADING),
  );
  if (message === undefined || message.role !== "user") return undefined;
  return summaryFrom(message.text, message.text.indexOf(ANCHORED_SUMMARY_HEADING));
}

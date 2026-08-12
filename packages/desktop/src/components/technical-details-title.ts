import type { TimelineItem } from "../state.js";

/** The first user message titles the transcript, matching the sidebar's session naming. */
export function sessionTitle(timeline: TimelineItem[], sessionId: string): string {
  const firstUser = timeline.find((item) => item.kind === "user")?.text;
  if (firstUser === undefined) return `Session ${sessionId}`;
  return firstUser.replaceAll(/\s+/gu, " ").trim().slice(0, 60) || `Session ${sessionId}`;
}

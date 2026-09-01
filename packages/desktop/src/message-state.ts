import type { ConversationMessage } from "@gardendesk/shared";
import type { DesktopState, TimelineItem } from "./state.js";

export function appendMessage(state: DesktopState, message: ConversationMessage): DesktopState {
  const timeline = [
    ...state.timeline,
    {
      createdAt: message.createdAt,
      id: message.id,
      kind: message.role,
      text: message.content,
      runId: message.runId,
    } satisfies TimelineItem,
  ];
  const title =
    message.role === "user" ? message.content.replaceAll(/\s+/gu, " ").slice(0, 60) : undefined;
  return {
    ...state,
    draft: "",
    timeline,
    globalSessions: state.globalSessions.map((session) =>
      session.id === message.sessionId && session.title === "New chat" && title !== undefined
        ? { ...session, title }
        : session,
    ),
    folders: state.folders.map((folder) => ({
      ...folder,
      sessions: folder.sessions.map((session) =>
        session.id === message.sessionId && session.title === "New chat" && title !== undefined
          ? { ...session, title }
          : session,
      ),
    })),
  };
}

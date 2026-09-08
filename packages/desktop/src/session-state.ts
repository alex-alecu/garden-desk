import { type ConversationMessage, conversationTitle } from "@gardendesk/shared";
import { applyAgentSnapshot } from "./agent-state.js";
import type { DesktopAction, DesktopState } from "./state.js";
import { emptyConversation } from "./state-initial.js";

export function loadMessages(
  state: DesktopState,
  sessionId: string,
  messages: ConversationMessage[],
): DesktopState {
  if (state.activeSessionId !== sessionId) return state;
  const firstMessage = messages.find((message) => message.role === "user");
  const title =
    firstMessage === undefined
      ? undefined
      : conversationTitle(firstMessage.content, state.attachments[0]?.name);
  return {
    ...state,
    timeline: [
      ...messages.map((message) => ({
        createdAt: message.createdAt,
        id: message.id,
        kind: message.role,
        text: message.content,
        runId: message.runId,
      })),
      ...state.timeline.filter((item) => item.kind === "activity"),
    ],
    globalSessions: state.globalSessions.map((session) =>
      session.id === sessionId && title !== undefined ? { ...session, title } : session,
    ),
    folders: state.folders.map((folder) => ({
      ...folder,
      sessions: folder.sessions.map((session) =>
        session.id === sessionId && title !== undefined ? { ...session, title } : session,
      ),
    })),
  };
}

export function loadSession(
  state: DesktopState,
  action: Extract<DesktopAction, { type: "session.loaded" }>,
): DesktopState {
  if (state.pendingSessionId !== action.sessionId) return state;
  let loaded = loadMessages(
    {
      ...state,
      ...emptyConversation(undefined),
      activeSessionId: action.sessionId,
      attachments: action.attachments,
      removableAttachmentIds: action.removableIds,
      draft: action.draft,
    },
    action.sessionId,
    action.messages,
  );
  for (const snapshot of action.snapshots) {
    loaded = applyAgentSnapshot(loaded, snapshot);
  }
  return loaded;
}

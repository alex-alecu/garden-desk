import type { DesktopState } from "./state.js";

export const initialDesktopState: DesktopState = {
  catalogPath: "",
  folders: [],
  globalSessions: [],
  activeSessionId: undefined,
  newSessionFolderId: undefined,
  draft: "",
  timeline: [],
  attachments: [],
  removableAttachmentIds: [],
  activeRun: undefined,
  artifacts: [],
  executions: [],
  thinking: null,
  loaded: false,
};

export function emptyConversation(newSessionFolderId: string | null | undefined) {
  return {
    activeSessionId: undefined,
    newSessionFolderId,
    draft: "",
    timeline: [],
    attachments: [],
    removableAttachmentIds: [],
    activeRun: undefined,
    artifacts: [],
    executions: [],
    thinking: null,
  };
}

import type { DesktopState } from "./state.js";

export const initialDesktopState: DesktopState = {
  catalogPath: "",
  folders: [],
  globalSessions: [],
  activeSessionId: undefined,
  pendingSessionId: undefined,
  newSessionFolderId: undefined,
  draft: "",
  timeline: [],
  attachments: [],
  removableAttachmentIds: [],
  activeRun: undefined,
  workingSessionIds: [],
  artifacts: [],
  executions: [],
  thinking: null,
  thinkingBySession: {},
  question: null,
  contextUsedTokens: null,
  contextAllocatedTokens: null,
  loaded: false,
  selectedStepId: undefined,
  traces: [],
};

export function emptyConversation(newSessionFolderId: string | null | undefined) {
  return {
    activeSessionId: undefined,
    pendingSessionId: undefined,
    newSessionFolderId,
    draft: "",
    timeline: [],
    attachments: [],
    removableAttachmentIds: [],
    activeRun: undefined,
    artifacts: [],
    executions: [],
    thinking: null,
    question: null,
    contextUsedTokens: null,
    contextAllocatedTokens: null,
    selectedStepId: undefined,
    traces: [],
  };
}

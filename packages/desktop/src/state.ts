import type {
  AgentArtifactSummary,
  AgentExecutionSnapshot,
  AgentQuestionRequest,
  AgentRunSnapshot,
  AgentRunSummary,
  AgentTrace,
  AttachmentSummary,
  ConversationMessage,
  FolderSummary,
  SessionPage,
  SessionSummary,
} from "@vault/shared";
import { applyAgentSnapshot } from "./agent-state.js";
import type { DesktopBootstrap } from "./api.js";
import { appendMessage } from "./message-state.js";
import { emptyConversation } from "./state-initial.js";
import type { FolderGroup, TimelineItem } from "./state-types.js";

export { initialDesktopState } from "./state-initial.js";
export type { FolderGroup, TimelineItem } from "./state-types.js";

export interface DesktopState {
  catalogPath: string;
  folders: FolderGroup[];
  globalSessions: SessionSummary[];
  activeSessionId: string | undefined;
  newSessionFolderId: string | null | undefined;
  draft: string;
  timeline: TimelineItem[];
  attachments: AttachmentSummary[];
  removableAttachmentIds: string[];
  activeRun: AgentRunSummary | undefined;
  workingSessionIds: string[];
  artifacts: AgentArtifactSummary[];
  executions: AgentExecutionSnapshot[];
  thinking: string | null;
  question: AgentQuestionRequest | null;
  loaded: boolean;
  selectedStepId: string | undefined;
  traces: AgentTrace[];
  contextUsedTokens: number | null;
  contextAllocatedTokens: number | null;
}

export type DesktopAction =
  | { type: "desktop.hydrate"; snapshot: DesktopBootstrap }
  | { type: "folder.add"; folder: FolderSummary }
  | { type: "folder.revoked"; folderId: string }
  | { type: "folders.reorder"; folderIds: string[] }
  | { type: "folder.toggle"; folderId: string }
  | { type: "folder.page"; folderId: string; page: SessionPage }
  | { type: "folder.refresh"; folderId: string; page: SessionPage }
  | { type: "session.created"; session: SessionSummary }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.new"; folderId: string | null }
  | { type: "session.select"; sessionId: string }
  | { type: "messages.load"; sessionId: string; messages: ConversationMessage[] }
  | { type: "message.append"; message: ConversationMessage }
  | {
      type: "attachments.load";
      sessionId: string;
      attachments: AttachmentSummary[];
      removableIds: string[];
    }
  | { type: "attachments.add"; attachments: AttachmentSummary[] }
  | { type: "attachment.remove"; attachmentId: string }
  | { type: "agent.started"; run: AgentRunSummary }
  | { type: "agent.snapshot"; snapshot: AgentRunSnapshot }
  | { type: "draft.load"; sessionId: string; draft: string }
  | { type: "draft.change"; draft: string }
  | { type: "step.select"; stepId: string | undefined }
  | { type: "trace.load"; trace: AgentTrace };

function hydrate(state: DesktopState, snapshot: DesktopBootstrap): DesktopState {
  const pages = new Map(snapshot.folderSessions.map((item) => [item.folderId, item.page]));
  return {
    ...state,
    catalogPath: snapshot.catalogPath,
    loaded: true,
    folders: snapshot.folders.map((folder) => {
      const page = pages.get(folder.id);
      return {
        ...folder,
        sessions: page?.items ?? [],
        nextCursor: page?.nextCursor ?? null,
        expanded: true,
      };
    }),
    globalSessions: snapshot.globalSessions.items,
  };
}

function addFolder(state: DesktopState, folder: FolderSummary): DesktopState {
  if (state.folders.some((item) => item.id === folder.id)) return state;
  return {
    ...state,
    folders: [...state.folders, { ...folder, sessions: [], expanded: true, nextCursor: null }],
  };
}

function addSession(state: DesktopState, session: SessionSummary): DesktopState {
  if (session.folderId === null) {
    return {
      ...state,
      ...emptyConversation(undefined),
      activeSessionId: session.id,
      globalSessions: [session, ...state.globalSessions].slice(0, 5),
    };
  }
  return {
    ...state,
    ...emptyConversation(undefined),
    activeSessionId: session.id,
    folders: state.folders.map((folder) =>
      folder.id === session.folderId
        ? { ...folder, expanded: true, sessions: [session, ...folder.sessions] }
        : folder,
    ),
  };
}

function withTrace(state: DesktopState, trace: AgentTrace): DesktopState {
  return {
    ...state,
    traces: [...state.traces.filter((item) => item.runId !== trace.runId), trace],
  };
}

function appendFolderPage(state: DesktopState, folderId: string, page: SessionPage): DesktopState {
  return {
    ...state,
    folders: state.folders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            sessions: [
              ...folder.sessions,
              ...page.items.filter(
                (item) => !folder.sessions.some((session) => session.id === item.id),
              ),
            ],
            nextCursor: page.nextCursor,
          }
        : folder,
    ),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one exhaustive reducer keeps desktop transitions deterministic.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: reducer cases are intentionally flat and side-effect free.
export function desktopReducer(state: DesktopState, action: DesktopAction): DesktopState {
  if (action.type === "desktop.hydrate") return hydrate(state, action.snapshot);
  if (action.type === "folder.add") return addFolder(state, action.folder);
  if (action.type === "folder.revoked") {
    const removed = state.folders.find((folder) => folder.id === action.folderId);
    const activeRemoved = removed?.sessions.some((session) => session.id === state.activeSessionId);
    return {
      ...state,
      folders: state.folders.filter((folder) => folder.id !== action.folderId),
      ...(activeRemoved ? emptyConversation(undefined) : {}),
      ...(state.newSessionFolderId === action.folderId ? { newSessionFolderId: null } : {}),
    };
  }
  if (action.type === "folders.reorder") {
    const positions = new Map(action.folderIds.map((id, index) => [id, index]));
    return {
      ...state,
      folders: [...state.folders].sort(
        (left, right) =>
          (positions.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(right.id) ?? Number.MAX_SAFE_INTEGER),
      ),
    };
  }
  if (action.type === "folder.toggle") {
    return {
      ...state,
      folders: state.folders.map((folder) =>
        folder.id === action.folderId ? { ...folder, expanded: !folder.expanded } : folder,
      ),
    };
  }
  if (action.type === "folder.page") return appendFolderPage(state, action.folderId, action.page);
  if (action.type === "folder.refresh") {
    return {
      ...state,
      folders: state.folders.map((folder) =>
        folder.id === action.folderId
          ? { ...folder, sessions: action.page.items, nextCursor: action.page.nextCursor }
          : folder,
      ),
    };
  }
  if (action.type === "session.created") return addSession(state, action.session);
  if (action.type === "session.deleted") {
    const activeDeleted = state.activeSessionId === action.sessionId;
    return {
      ...state,
      globalSessions: state.globalSessions.filter((session) => session.id !== action.sessionId),
      folders: state.folders.map((folder) => ({
        ...folder,
        sessions: folder.sessions.filter((session) => session.id !== action.sessionId),
      })),
      workingSessionIds: state.workingSessionIds.filter((id) => id !== action.sessionId),
      ...(activeDeleted ? emptyConversation(null) : {}),
    };
  }
  if (action.type === "session.new") {
    return { ...state, ...emptyConversation(action.folderId) };
  }
  if (action.type === "session.select") {
    return {
      ...state,
      ...emptyConversation(undefined),
      activeSessionId: action.sessionId,
    };
  }
  if (action.type === "messages.load") {
    if (state.activeSessionId !== action.sessionId) return state;
    const title = action.messages
      .find((message) => message.role === "user")
      ?.content.replaceAll(/\s+/gu, " ")
      .slice(0, 60);
    return {
      ...state,
      timeline: [
        ...action.messages.map((message) => ({
          createdAt: message.createdAt,
          id: message.id,
          kind: message.role,
          text: message.content,
          runId: message.runId,
        })),
        ...state.timeline.filter((item) => item.kind === "activity"),
      ],
      globalSessions: state.globalSessions.map((session) =>
        session.id === action.sessionId && title !== undefined ? { ...session, title } : session,
      ),
      folders: state.folders.map((folder) => ({
        ...folder,
        sessions: folder.sessions.map((session) =>
          session.id === action.sessionId && title !== undefined ? { ...session, title } : session,
        ),
      })),
    };
  }
  if (action.type === "message.append") return appendMessage(state, action.message);
  if (action.type === "attachments.load") {
    return state.activeSessionId === action.sessionId
      ? {
          ...state,
          attachments: action.attachments,
          removableAttachmentIds: action.removableIds,
        }
      : state;
  }
  if (action.type === "attachments.add") {
    return {
      ...state,
      attachments: [...state.attachments, ...action.attachments],
      removableAttachmentIds: [
        ...state.removableAttachmentIds,
        ...action.attachments.map((item) => item.id),
      ],
    };
  }
  if (action.type === "attachment.remove") {
    return {
      ...state,
      attachments: state.attachments.filter((item) => item.id !== action.attachmentId),
      removableAttachmentIds: state.removableAttachmentIds.filter(
        (item) => item !== action.attachmentId,
      ),
    };
  }
  if (action.type === "agent.started") {
    return {
      ...state,
      activeRun: action.run,
      workingSessionIds: [...new Set([...state.workingSessionIds, action.run.sessionId])],
      thinking: null,
      question: null,
      draft: "",
      removableAttachmentIds: [],
    };
  }
  if (action.type === "agent.snapshot") {
    return applyAgentSnapshot(state, action.snapshot);
  }
  if (action.type === "draft.load") {
    return state.activeSessionId === action.sessionId && state.draft.length === 0
      ? { ...state, draft: action.draft }
      : state;
  }
  if (action.type === "step.select") return { ...state, selectedStepId: action.stepId };
  if (action.type === "trace.load") return withTrace(state, action.trace);
  return { ...state, draft: action.draft };
}

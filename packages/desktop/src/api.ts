import type {
  AgentRunSnapshot,
  AgentRunSummary,
  AttachmentSummary,
  ConversationMessage,
  FolderSummary,
  ModelRuntimeStatus,
  SessionDraft,
  SessionPage,
  SessionSummary,
} from "@vault/shared";

export interface FolderSessionPage {
  folderId: string;
  page: SessionPage;
}

export interface DesktopBootstrap {
  catalogPath: string;
  folders: FolderSummary[];
  globalSessions: SessionPage;
  folderSessions: FolderSessionPage[];
  initialSessionId?: string;
  model: ModelRuntimeStatus;
}

export interface DesktopApi {
  bootstrapDesktop(): Promise<DesktopBootstrap>;
  getModelStatus(): Promise<ModelRuntimeStatus>;
  unloadModel(): Promise<boolean>;
  chooseFolder(): Promise<FolderSummary | undefined>;
  revokeFolder(folderId: string): Promise<boolean>;
  openFolder(folderId: string): Promise<void>;
  createSession(folderId: string | null): Promise<SessionSummary>;
  deleteSession(sessionId: string): Promise<boolean>;
  listSessions(folderId: string | null, cursor?: string): Promise<SessionPage>;
  listMessages(sessionId: string): Promise<ConversationMessage[]>;
  appendUserMessage(sessionId: string, content: string): Promise<ConversationMessage>;
  chooseFiles(sessionId: string): Promise<AttachmentSummary[]>;
  listAttachments(sessionId: string): Promise<AttachmentSummary[]>;
  removeAttachment(sessionId: string, attachmentId: string): Promise<boolean>;
  saveDraft(sessionId: string, content: string): Promise<SessionDraft>;
  loadDraft(sessionId: string): Promise<SessionDraft | undefined>;
  startAgent(sessionId: string, task: string): Promise<AgentRunSummary>;
  getAgentRun(runId: string): Promise<AgentRunSnapshot>;
  listAgentRuns(sessionId: string): Promise<AgentRunSummary[]>;
  cancelAgent(jobId: string): Promise<boolean>;
  createDebugSnapshot(sessionId: string): Promise<string>;
  revealDebugSnapshot(sessionId: string): Promise<void>;
}

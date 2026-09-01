import type {
  AgentRunSnapshot,
  AgentRunSummary,
  AgentTrace,
  AttachmentSummary,
  ConversationMessage,
  FolderSummary,
  ModelRuntimeStatus,
  SessionDraft,
  SessionPage,
  SessionSummary,
} from "@gardendesk/shared";

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

export type NativeDropEvent =
  | { type: "enter" | "drop"; paths: string[] }
  | { type: "over" }
  | { type: "leave" };

export interface DroppedPaths {
  files: string[];
  folders: string[];
}

export type SecureWorkspaceState =
  | "ready"
  | "permission_required"
  | "sign_out_required"
  | "unavailable";

export interface SecureWorkspaceStatus {
  state: SecureWorkspaceState;
}

export interface SecureWorkspaceSetupResult {
  outcome: "completed" | "existing_membership" | "cancelled" | "not_needed";
  status: SecureWorkspaceStatus;
}

export interface DesktopApi {
  bootstrapDesktop(): Promise<DesktopBootstrap>;
  getSecureWorkspaceStatus(): Promise<SecureWorkspaceStatus>;
  configureSecureWorkspace(): Promise<SecureWorkspaceSetupResult>;
  getModelStatus(): Promise<ModelRuntimeStatus>;
  unloadModel(): Promise<boolean>;
  chooseFolder(): Promise<FolderSummary | undefined>;
  classifyDroppedPaths(paths: string[]): Promise<DroppedPaths>;
  addFolders(paths: string[]): Promise<FolderSummary[]>;
  reorderFolders(folderIds: string[]): Promise<FolderSummary[]>;
  revokeFolder(folderId: string): Promise<boolean>;
  openFolder(folderId: string): Promise<void>;
  createSession(folderId: string | null): Promise<SessionSummary>;
  deleteSession(sessionId: string): Promise<boolean>;
  listSessions(folderId: string | null, cursor?: string): Promise<SessionPage>;
  listMessages(sessionId: string): Promise<ConversationMessage[]>;
  appendUserMessage(sessionId: string, content: string): Promise<ConversationMessage>;
  chooseFiles(sessionId: string): Promise<AttachmentSummary[]>;
  addFiles(sessionId: string, paths: string[]): Promise<AttachmentSummary[]>;
  listAttachments(sessionId: string): Promise<AttachmentSummary[]>;
  openAttachment(sessionId: string, attachmentId: string): Promise<void>;
  openArtifact(sessionId: string, artifactId: string): Promise<void>;
  saveArtifact(sessionId: string, artifactId: string, name: string): Promise<boolean>;
  removeAttachment(sessionId: string, attachmentId: string): Promise<boolean>;
  saveDraft(sessionId: string, content: string): Promise<SessionDraft>;
  loadDraft(sessionId: string): Promise<SessionDraft | undefined>;
  startAgent(sessionId: string, task: string): Promise<AgentRunSummary>;
  getAgentRun(runId: string): Promise<AgentRunSnapshot>;
  getAgentTrace(runId: string): Promise<AgentTrace>;
  listAgentRuns(sessionId: string): Promise<AgentRunSummary[]>;
  cancelAgent(jobId: string): Promise<boolean>;
  answerQuestion(runId: string, questionId: string, answers: string[][]): Promise<boolean>;
  dismissQuestion(runId: string, questionId: string): Promise<boolean>;
  createDebugSnapshot(sessionId: string): Promise<string>;
  revealDebugSnapshot(sessionId: string): Promise<void>;
  listenForDroppedPaths?(listener: (event: NativeDropEvent) => void): Promise<() => void>;
}

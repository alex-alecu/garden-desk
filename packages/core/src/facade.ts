import type {
  AgentRunSnapshot,
  AgentRunSummary,
  AgentTrace,
  AttachmentSummary,
  ConversationMessage,
  FolderSummary,
  MessageRole,
  SessionDraft,
  SessionPage,
  SessionSummary,
  WorkspaceStatus,
} from "@vault/shared";
import type { EmbeddingInput, GenerationInput, InferenceService } from "./runtime/inference.js";

export interface VaultCorePorts extends InferenceService {
  status(): Promise<WorkspaceStatus>;
  addFolder(rootPath: string): Promise<FolderSummary>;
  listFolders(): Promise<FolderSummary[]>;
  reorderFolders(folderIds: string[]): Promise<FolderSummary[]>;
  resolveFolderPath(folderId: string): Promise<string>;
  revokeFolder(folderId: string): Promise<boolean>;
  createSession(folderId: string | null): Promise<SessionSummary>;
  deleteSession(sessionId: string): Promise<boolean>;
  listSessions(folderId: string | null, cursor?: string, limit?: number): Promise<SessionPage>;
  appendMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
  ): Promise<ConversationMessage>;
  listMessages(sessionId: string): Promise<ConversationMessage[]>;
  saveDraft(sessionId: string, content: string): Promise<SessionDraft>;
  loadDraft(sessionId: string): Promise<SessionDraft | undefined>;
  addAttachment(sessionId: string, path: string): Promise<AttachmentSummary>;
  listAttachments(sessionId: string): Promise<AttachmentSummary[]>;
  materializeAttachment(sessionId: string, attachmentId: string): Promise<string>;
  removeAttachment(sessionId: string, attachmentId: string): Promise<boolean>;
  startAgent(sessionId: string, task: string): Promise<AgentRunSummary>;
  listAgentRuns(sessionId: string): Promise<AgentRunSummary[]>;
  getAgentRun(runId: string): Promise<AgentRunSnapshot>;
  getAgentTrace(runId: string): Promise<AgentTrace>;
  cancelAgent(jobId: string): Promise<boolean>;
  cancelJob(jobId: string): Promise<boolean>;
  verifyAudit(): Promise<boolean>;
  close(): Promise<void>;
}

export interface VaultCore extends VaultCorePorts {}

export function createFacade(ports: VaultCorePorts): VaultCore {
  return {
    status: () => ports.status(),
    addFolder: (rootPath) => ports.addFolder(rootPath),
    listFolders: () => ports.listFolders(),
    reorderFolders: (folderIds) => ports.reorderFolders(folderIds),
    resolveFolderPath: (folderId) => ports.resolveFolderPath(folderId),
    revokeFolder: (folderId) => ports.revokeFolder(folderId),
    createSession: (folderId) => ports.createSession(folderId),
    deleteSession: (sessionId) => ports.deleteSession(sessionId),
    listSessions: (folderId, cursor, limit) => ports.listSessions(folderId, cursor, limit),
    appendMessage: (sessionId, role, content) => ports.appendMessage(sessionId, role, content),
    listMessages: (sessionId) => ports.listMessages(sessionId),
    saveDraft: (sessionId, content) => ports.saveDraft(sessionId, content),
    loadDraft: (sessionId) => ports.loadDraft(sessionId),
    addAttachment: (sessionId, path) => ports.addAttachment(sessionId, path),
    listAttachments: (sessionId) => ports.listAttachments(sessionId),
    materializeAttachment: (sessionId, attachmentId) =>
      ports.materializeAttachment(sessionId, attachmentId),
    removeAttachment: (sessionId, attachmentId) => ports.removeAttachment(sessionId, attachmentId),
    startAgent: (sessionId, task) => ports.startAgent(sessionId, task),
    listAgentRuns: (sessionId) => ports.listAgentRuns(sessionId),
    getAgentRun: (runId) => ports.getAgentRun(runId),
    getAgentTrace: (runId) => ports.getAgentTrace(runId),
    cancelAgent: (jobId) => ports.cancelAgent(jobId),
    cancelJob: (jobId) => ports.cancelJob(jobId),
    verifyAudit: () => ports.verifyAudit(),
    generate: (
      input: GenerationInput,
      signal?: AbortSignal,
      onThinkingDelta?: (text: string) => void,
      identity?: Parameters<InferenceService["generate"]>[3],
    ) => ports.generate(input, signal, onThinkingDelta, identity),
    embed: (input: EmbeddingInput, signal?: AbortSignal) => ports.embed(input, signal),
    modelStatus: () => ports.modelStatus(),
    unloadModel: () => ports.unloadModel(),
    close: () => ports.close(),
  };
}

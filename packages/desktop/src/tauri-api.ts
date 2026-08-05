import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AgentRunSnapshotSchema,
  AgentRunSummarySchema,
  AgentTraceSchema,
  AttachmentSummarySchema,
  ConversationMessageSchema,
  FolderSummarySchema,
  ModelRuntimeStatusSchema,
  SessionDraftSchema,
  SessionPageSchema,
  SessionSummarySchema,
} from "@vault/shared";
import type {
  DesktopApi,
  DesktopBootstrap,
  DroppedPaths,
  SecureWorkspaceSetupResult,
  SecureWorkspaceState,
  SecureWorkspaceStatus,
} from "./api.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The desktop bridge returned an invalid response.");
  }
  return value as Record<string, unknown>;
}

function parseDroppedPaths(value: unknown): DroppedPaths {
  const input = record(value);
  if (
    !Array.isArray(input.files) ||
    !input.files.every((path) => typeof path === "string") ||
    !Array.isArray(input.folders) ||
    !input.folders.every((path) => typeof path === "string")
  ) {
    throw new Error("The desktop bridge returned invalid dropped paths.");
  }
  return { files: input.files as string[], folders: input.folders as string[] };
}

function parseBootstrap(value: unknown): DesktopBootstrap {
  const input = record(value);
  const folderSessions = Array.isArray(input.folderSessions)
    ? input.folderSessions.map((entry) => {
        const item = record(entry);
        if (typeof item.folderId !== "string") throw new Error("Invalid folder session page.");
        return { folderId: item.folderId, page: SessionPageSchema.parse(item.page) };
      })
    : [];
  if (typeof input.catalogPath !== "string") throw new Error("Invalid catalog path.");
  return {
    catalogPath: input.catalogPath,
    folders: FolderSummarySchema.array().parse(input.folders),
    globalSessions: SessionPageSchema.parse(input.globalSessions),
    folderSessions,
    model: ModelRuntimeStatusSchema.parse(input.model),
  };
}

const secureWorkspaceStates = new Set<SecureWorkspaceState>([
  "ready",
  "permission_required",
  "sign_out_required",
  "unavailable",
]);

function parseSecureWorkspaceStatus(value: unknown): SecureWorkspaceStatus {
  const input = record(value);
  if (
    typeof input.state !== "string" ||
    !secureWorkspaceStates.has(input.state as SecureWorkspaceState)
  ) {
    throw new Error("The desktop bridge returned an invalid secure workspace status.");
  }
  return { state: input.state as SecureWorkspaceState };
}

function parseSecureWorkspaceSetupResult(value: unknown): SecureWorkspaceSetupResult {
  const input = record(value);
  if (
    !["completed", "existing_membership", "cancelled", "not_needed"].includes(String(input.outcome))
  ) {
    throw new Error("The desktop bridge returned an invalid secure workspace setup result.");
  }
  return {
    outcome: input.outcome as SecureWorkspaceSetupResult["outcome"],
    status: parseSecureWorkspaceStatus(input.status),
  };
}

export const tauriDesktopApi: DesktopApi = {
  async bootstrapDesktop() {
    return parseBootstrap(await invoke<unknown>("desktop_bootstrap"));
  },
  async getSecureWorkspaceStatus() {
    return parseSecureWorkspaceStatus(await invoke("secure_workspace_status"));
  },
  async configureSecureWorkspace() {
    return parseSecureWorkspaceSetupResult(await invoke("configure_secure_workspace"));
  },
  async getModelStatus() {
    return ModelRuntimeStatusSchema.parse(await invoke("model_status"));
  },
  async unloadModel() {
    return record(await invoke("unload_model")).unloaded === true;
  },
  async chooseFolder() {
    const value = await invoke<unknown | null>("choose_folder");
    return value === null ? undefined : FolderSummarySchema.parse(value);
  },
  async classifyDroppedPaths(paths) {
    return parseDroppedPaths(await invoke("classify_dropped_paths", { paths }));
  },
  async addFolders(paths) {
    return FolderSummarySchema.array().parse(await invoke("add_dropped_folders", { paths }));
  },
  async reorderFolders(folderIds) {
    return FolderSummarySchema.array().parse(await invoke("reorder_folders", { folderIds }));
  },
  async revokeFolder(folderId) {
    return record(await invoke("revoke_folder", { folderId })).revoked === true;
  },
  async openFolder(folderId) {
    await invoke("open_folder", { folderId });
  },
  async createSession(folderId) {
    return SessionSummarySchema.parse(await invoke("create_session", { folderId }));
  },
  async deleteSession(sessionId) {
    return record(await invoke("delete_session", { sessionId })).deleted === true;
  },
  async listSessions(folderId, cursor) {
    return SessionPageSchema.parse(await invoke("list_sessions", { folderId, cursor }));
  },
  async listMessages(sessionId) {
    return ConversationMessageSchema.array().parse(await invoke("list_messages", { sessionId }));
  },
  async appendUserMessage(sessionId, content) {
    return ConversationMessageSchema.parse(
      await invoke("append_user_message", { sessionId, content }),
    );
  },
  async chooseFiles(sessionId) {
    return AttachmentSummarySchema.array().parse(await invoke("choose_files", { sessionId }));
  },
  async addFiles(sessionId, paths) {
    return AttachmentSummarySchema.array().parse(
      await invoke("add_dropped_files", { sessionId, paths }),
    );
  },
  async listAttachments(sessionId) {
    return AttachmentSummarySchema.array().parse(await invoke("list_attachments", { sessionId }));
  },
  async openAttachment(sessionId, attachmentId) {
    await invoke("open_attachment", { sessionId, attachmentId });
  },
  async openArtifact(sessionId, artifactId) {
    await invoke("open_artifact", { sessionId, artifactId });
  },
  async saveArtifact(sessionId, artifactId, name) {
    return record(await invoke("save_artifact", { sessionId, artifactId, name })).saved === true;
  },
  async removeAttachment(sessionId, attachmentId) {
    return record(await invoke("remove_attachment", { sessionId, attachmentId })).removed === true;
  },
  async saveDraft(sessionId, content) {
    return SessionDraftSchema.parse(await invoke("save_draft", { sessionId, content }));
  },
  async loadDraft(sessionId) {
    const value = await invoke<unknown | null>("load_draft", { sessionId });
    return value === null ? undefined : SessionDraftSchema.parse(value);
  },
  async startAgent(sessionId, task) {
    return AgentRunSummarySchema.parse(await invoke("start_agent", { sessionId, task }));
  },
  async getAgentRun(runId) {
    return AgentRunSnapshotSchema.parse(await invoke("get_agent_run", { runId }));
  },
  async getAgentTrace(runId) {
    return AgentTraceSchema.parse(await invoke("get_agent_trace", { runId }));
  },
  async listAgentRuns(sessionId) {
    return AgentRunSummarySchema.array().parse(await invoke("list_agent_runs", { sessionId }));
  },
  async cancelAgent(jobId) {
    return record(await invoke("cancel_agent", { jobId })).cancelled === true;
  },
  async createDebugSnapshot(sessionId) {
    const value = record(await invoke("create_debug_snapshot", { sessionId }));
    if (typeof value.path !== "string" || value.path.length === 0) {
      throw new Error("The desktop bridge returned an invalid debug snapshot path.");
    }
    return value.path;
  },
  async revealDebugSnapshot(sessionId) {
    await invoke("reveal_debug_snapshot", { sessionId });
  },
  async listenForDroppedPaths(listener) {
    return await getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "leave") {
        listener({ type: "leave" });
        return;
      }
      listener(payload.type === "over" ? { type: "over" } : payload);
    });
  },
};

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
} from "@gardendesk/shared";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type {
  DesktopApi,
  DesktopBootstrap,
  DroppedPaths,
  SecureWorkspaceSetupResult,
  SecureWorkspaceState,
  SecureWorkspaceStatus,
} from "./api.js";
import { invokeDesktop, withDevelopmentError } from "./development-errors.js";

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
    return invokeDesktop("desktop_bootstrap", parseBootstrap);
  },
  async getSecureWorkspaceStatus() {
    return invokeDesktop("secure_workspace_status", parseSecureWorkspaceStatus);
  },
  async configureSecureWorkspace() {
    return invokeDesktop("configure_secure_workspace", parseSecureWorkspaceSetupResult);
  },
  async getModelStatus() {
    return invokeDesktop("model_status", (value) => ModelRuntimeStatusSchema.parse(value));
  },
  async unloadModel() {
    return invokeDesktop("unload_model", (value) => record(value).unloaded === true);
  },
  async chooseFolder() {
    return invokeDesktop("choose_folder", (value) =>
      value === null ? undefined : FolderSummarySchema.parse(value),
    );
  },
  async classifyDroppedPaths(paths) {
    return invokeDesktop("classify_dropped_paths", parseDroppedPaths, { paths });
  },
  async addFolders(paths) {
    return invokeDesktop(
      "add_dropped_folders",
      (value) => FolderSummarySchema.array().parse(value),
      { paths },
    );
  },
  async reorderFolders(folderIds) {
    return invokeDesktop("reorder_folders", (value) => FolderSummarySchema.array().parse(value), {
      folderIds,
    });
  },
  async revokeFolder(folderId) {
    return invokeDesktop("revoke_folder", (value) => record(value).revoked === true, {
      folderId,
    });
  },
  async openFolder(folderId) {
    await invokeDesktop("open_folder", () => undefined, { folderId });
  },
  async createSession(folderId) {
    return invokeDesktop("create_session", (value) => SessionSummarySchema.parse(value), {
      folderId,
    });
  },
  async deleteSession(sessionId) {
    return invokeDesktop("delete_session", (value) => record(value).deleted === true, {
      sessionId,
    });
  },
  async listSessions(folderId, cursor) {
    return invokeDesktop("list_sessions", (value) => SessionPageSchema.parse(value), {
      folderId,
      cursor,
    });
  },
  async listMessages(sessionId) {
    return invokeDesktop(
      "list_messages",
      (value) => ConversationMessageSchema.array().parse(value),
      { sessionId },
    );
  },
  async appendUserMessage(sessionId, content) {
    return invokeDesktop("append_user_message", (value) => ConversationMessageSchema.parse(value), {
      sessionId,
      content,
    });
  },
  async chooseFiles(sessionId) {
    return invokeDesktop("choose_files", (value) => AttachmentSummarySchema.array().parse(value), {
      sessionId,
    });
  },
  async addFiles(sessionId, paths) {
    return invokeDesktop(
      "add_dropped_files",
      (value) => AttachmentSummarySchema.array().parse(value),
      { sessionId, paths },
    );
  },
  async listAttachments(sessionId) {
    return invokeDesktop(
      "list_attachments",
      (value) => AttachmentSummarySchema.array().parse(value),
      { sessionId },
    );
  },
  async openAttachment(sessionId, attachmentId) {
    await invokeDesktop("open_attachment", () => undefined, { sessionId, attachmentId });
  },
  async openArtifact(sessionId, artifactId) {
    await invokeDesktop("open_artifact", () => undefined, { sessionId, artifactId });
  },
  async saveArtifact(sessionId, artifactId, name) {
    return invokeDesktop("save_artifact", (value) => record(value).saved === true, {
      sessionId,
      artifactId,
      name,
    });
  },
  async removeAttachment(sessionId, attachmentId) {
    return invokeDesktop("remove_attachment", (value) => record(value).removed === true, {
      sessionId,
      attachmentId,
    });
  },
  async saveDraft(sessionId, content) {
    return invokeDesktop("save_draft", (value) => SessionDraftSchema.parse(value), {
      sessionId,
      content,
    });
  },
  async loadDraft(sessionId) {
    return invokeDesktop(
      "load_draft",
      (value) => (value === null ? undefined : SessionDraftSchema.parse(value)),
      { sessionId },
    );
  },
  async startAgent(sessionId, task) {
    return invokeDesktop("start_agent", (value) => AgentRunSummarySchema.parse(value), {
      sessionId,
      task,
    });
  },
  async getAgentRun(runId) {
    return invokeDesktop("get_agent_run", (value) => AgentRunSnapshotSchema.parse(value), {
      runId,
    });
  },
  async getAgentTrace(runId) {
    return invokeDesktop("get_agent_trace", (value) => AgentTraceSchema.parse(value), {
      runId,
    });
  },
  async listAgentRuns(sessionId) {
    return invokeDesktop("list_agent_runs", (value) => AgentRunSummarySchema.array().parse(value), {
      sessionId,
    });
  },
  async cancelAgent(jobId) {
    return invokeDesktop("cancel_agent", (value) => record(value).cancelled === true, { jobId });
  },
  async answerQuestion(runId, questionId, answers) {
    return invokeDesktop("answer_agent_question", (value) => record(value).answered === true, {
      runId,
      questionId,
      answers,
    });
  },
  async dismissQuestion(runId, questionId) {
    return invokeDesktop("dismiss_agent_question", (value) => record(value).dismissed === true, {
      runId,
      questionId,
    });
  },
  async createDebugSnapshot(sessionId) {
    return invokeDesktop(
      "create_debug_snapshot",
      (input) => {
        const value = record(input);
        if (typeof value.path !== "string" || value.path.length === 0) {
          throw new Error("The desktop bridge returned an invalid debug snapshot path.");
        }
        return value.path;
      },
      { sessionId },
    );
  },
  async revealDebugSnapshot(sessionId) {
    await invokeDesktop("reveal_debug_snapshot", () => undefined, { sessionId });
  },
  async listenForDroppedPaths(listener) {
    return await withDevelopmentError("listen_for_dropped_paths", async () =>
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          listener({ type: "leave" });
          return;
        }
        listener(payload.type === "over" ? { type: "over" } : payload);
      }),
    );
  },
};

import {
  AgentRunIdSchema,
  AttachmentIdSchema,
  type ErrorCode,
  FolderIdSchema,
  JobIdSchema,
  MessageRoleSchema,
  PROTOCOL_VERSION,
  type RpcRequest,
  RpcRequestSchema,
  type RpcResponse,
  SessionIdSchema,
} from "@vault/shared";
import type { VaultCore } from "../facade.js";
import { dispatchArtifactMethod } from "./artifact-methods.js";
import { dispatchQuestionMethod } from "./question-methods.js";

function failure(request: RpcRequest | undefined, code: ErrorCode, message: string): RpcResponse {
  return {
    jsonrpc: "2.0",
    id: request?.id ?? null,
    error: { code, message },
    protocolVersion: PROTOCOL_VERSION,
  };
}

function executionFailure(request: RpcRequest, error: unknown): RpcResponse {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "folder_not_found" ||
    message === "session_not_found" ||
    message === "run_not_found" ||
    message === "artifact_not_found"
  ) {
    return failure(request, "not_found", "The requested record was not found.");
  }
  if (message === "session_busy") {
    return failure(request, "workspace_busy", "Stop the running conversation before deleting it.");
  }
  if (message === "folder_grant_invalid") {
    return failure(request, "path_out_of_scope", "The selected folder is not available.");
  }
  if (message.startsWith("invalid_") || (error instanceof Error && error.name === "ZodError")) {
    return failure(request, "invalid_request", "The request parameters are invalid.");
  }
  return failure(request, "internal", "The request could not be completed.");
}

function success(request: RpcRequest, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id: request.id, result, protocolVersion: PROTOCOL_VERSION };
}

function nullableFolderId(value: unknown): string | null | undefined {
  if (value === null) return null;
  const parsed = FolderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function addFolder(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const path = request.params.rootPath;
  if (typeof path !== "string") return failure(request, "invalid_request", "Invalid folder path.");
  return success(request, await core.addFolder(path));
}

async function revokeFolder(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const folderId = FolderIdSchema.safeParse(request.params.folderId);
  if (!folderId.success) return failure(request, "invalid_request", "Invalid folder id.");
  return success(request, { revoked: await core.revokeFolder(folderId.data) });
}

async function reorderFolders(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const parsed = FolderIdSchema.array().safeParse(request.params.folderIds);
  if (!parsed.success) return failure(request, "invalid_request", "Invalid folder order.");
  return success(request, await core.reorderFolders(parsed.data));
}

async function resolveFolderPath(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const folderId = FolderIdSchema.safeParse(request.params.folderId);
  if (!folderId.success) return failure(request, "invalid_request", "Invalid folder id.");
  return success(request, await core.resolveFolderPath(folderId.data));
}

async function createSession(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const folderId = nullableFolderId(request.params.folderId);
  if (folderId === undefined) return failure(request, "invalid_request", "Invalid folder id.");
  return success(request, await core.createSession(folderId));
}

async function deleteSession(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = SessionIdSchema.safeParse(request.params.sessionId);
  if (!sessionId.success) return failure(request, "invalid_request", "Invalid session id.");
  return success(request, { deleted: await core.deleteSession(sessionId.data) });
}

async function listSessions(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const folderId = nullableFolderId(request.params.folderId);
  if (folderId === undefined) return failure(request, "invalid_request", "Invalid folder id.");
  const { cursor, limit } = request.params;
  if (cursor !== undefined && typeof cursor !== "string") {
    return failure(request, "invalid_request", "Invalid session cursor.");
  }
  if (limit !== undefined && typeof limit !== "number") {
    return failure(request, "invalid_request", "Invalid page limit.");
  }
  return success(request, await core.listSessions(folderId, cursor, limit));
}

async function appendMessage(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = SessionIdSchema.safeParse(request.params.sessionId);
  const role = MessageRoleSchema.safeParse(request.params.role);
  const { content } = request.params;
  if (!sessionId.success || !role.success || typeof content !== "string") {
    return failure(request, "invalid_request", "Invalid message.");
  }
  return success(request, await core.appendMessage(sessionId.data, role.data, content));
}

async function listMessages(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = SessionIdSchema.safeParse(request.params.sessionId);
  if (!sessionId.success) return failure(request, "invalid_request", "Invalid session id.");
  return success(request, await core.listMessages(sessionId.data));
}

function sessionIdParam(request: RpcRequest) {
  const parsed = SessionIdSchema.safeParse(request.params.sessionId);
  if (!parsed.success) throw new Error("invalid_session_id");
  return parsed.data;
}

async function saveDraft(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = sessionIdParam(request);
  const { content } = request.params;
  if (typeof content !== "string") return failure(request, "invalid_request", "Invalid draft.");
  return success(request, await core.saveDraft(sessionId, content));
}

async function loadDraft(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  return success(request, (await core.loadDraft(sessionIdParam(request))) ?? null);
}

async function addAttachment(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = sessionIdParam(request);
  const { path } = request.params;
  if (typeof path !== "string") return failure(request, "invalid_request", "Invalid file path.");
  return success(request, await core.addAttachment(sessionId, path));
}

async function listAttachments(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  return success(request, await core.listAttachments(sessionIdParam(request)));
}

async function materializeAttachment(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = sessionIdParam(request);
  const attachmentId = AttachmentIdSchema.safeParse(request.params.attachmentId);
  if (!attachmentId.success) return failure(request, "invalid_request", "Invalid attachment id.");
  return success(request, await core.materializeAttachment(sessionId, attachmentId.data));
}

async function removeAttachment(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = sessionIdParam(request);
  const attachmentId = AttachmentIdSchema.safeParse(request.params.attachmentId);
  if (!attachmentId.success) return failure(request, "invalid_request", "Invalid attachment id.");
  return success(request, {
    removed: await core.removeAttachment(sessionId, attachmentId.data),
  });
}

async function startAgent(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const sessionId = sessionIdParam(request);
  const { task } = request.params;
  if (typeof task !== "string" || task.trim().length === 0) {
    return failure(request, "invalid_request", "Invalid task.");
  }
  return success(request, await core.startAgent(sessionId, task));
}

async function getAgentRun(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const runId = AgentRunIdSchema.safeParse(request.params.runId);
  if (!runId.success) return failure(request, "invalid_request", "Invalid run id.");
  return success(request, await core.getAgentRun(runId.data));
}

async function getAgentTrace(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const runId = AgentRunIdSchema.safeParse(request.params.runId);
  if (!runId.success) return failure(request, "invalid_request", "Invalid run id.");
  return success(request, await core.getAgentTrace(runId.data));
}

async function listAgentRuns(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  return success(request, await core.listAgentRuns(sessionIdParam(request)));
}

async function cancelAgent(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const jobId = JobIdSchema.safeParse(request.params.jobId);
  if (!jobId.success) return failure(request, "invalid_request", "Invalid job id.");
  return success(request, { cancelled: await core.cancelAgent(jobId.data) });
}

async function questionMethod(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const result = await dispatchQuestionMethod(core, request);
  if (result.ok) return success(request, result.value);
  if (result.reason === "not_found") {
    return failure(request, "not_found", "The question is no longer open.");
  }
  return failure(request, "invalid_request", "Invalid question request.");
}

async function cancelJob(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  const jobId = JobIdSchema.safeParse(request.params.jobId);
  if (!jobId.success) return failure(request, "invalid_request", "Invalid job id.");
  return success(request, { cancelled: await core.cancelJob(jobId.data) });
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the exhaustive protocol switch keeps routing explicit.
async function dispatchMethod(core: VaultCore, request: RpcRequest): Promise<RpcResponse> {
  switch (request.method) {
    case "status":
      return success(request, await core.status());
    case "folders.add":
      return addFolder(core, request);
    case "folders.list":
      return success(request, await core.listFolders());
    case "folders.reorder":
      return reorderFolders(core, request);
    case "folders.resolvePath":
      return resolveFolderPath(core, request);
    case "folders.revoke":
      return revokeFolder(core, request);
    case "sessions.create":
      return createSession(core, request);
    case "sessions.delete":
      return deleteSession(core, request);
    case "sessions.list":
      return listSessions(core, request);
    case "messages.append":
      return appendMessage(core, request);
    case "messages.list":
      return listMessages(core, request);
    case "drafts.save":
      return saveDraft(core, request);
    case "drafts.load":
      return loadDraft(core, request);
    case "attachments.add":
      return addAttachment(core, request);
    case "attachments.list":
      return listAttachments(core, request);
    case "attachments.materialize":
      return materializeAttachment(core, request);
    case "attachments.remove":
      return removeAttachment(core, request);
    case "artifacts.materialize":
    case "artifacts.recordOpen":
    case "artifacts.export":
      return success(request, await dispatchArtifactMethod(core, request));
    case "agent.start":
      return startAgent(core, request);
    case "agent.list":
      return listAgentRuns(core, request);
    case "agent.get":
      return getAgentRun(core, request);
    case "agent.trace":
      return getAgentTrace(core, request);
    case "agent.cancel":
      return cancelAgent(core, request);
    case "agent.answerQuestion":
      return questionMethod(core, request);
    case "agent.dismissQuestion":
      return questionMethod(core, request);
    case "model.status":
      return success(request, await core.modelStatus());
    case "model.unload":
      return success(request, { unloaded: await core.unloadModel() });
    case "jobs.cancel":
      return cancelJob(core, request);
    default:
      return failure(request, "unsupported", `Unsupported method: ${request.method}`);
  }
}

export async function dispatchRpc(core: VaultCore, input: unknown): Promise<RpcResponse> {
  const parsed = RpcRequestSchema.safeParse(input);
  if (!parsed.success) return failure(undefined, "invalid_request", "Invalid JSON-RPC request.");
  if (parsed.data.protocolVersion !== PROTOCOL_VERSION) {
    return failure(
      parsed.data,
      "incompatible_version",
      `Protocol version ${PROTOCOL_VERSION} required.`,
    );
  }
  try {
    return await dispatchMethod(core, parsed.data);
  } catch (error) {
    return executionFailure(parsed.data, error);
  }
}

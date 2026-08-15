import { resolve } from "node:path";
import type { InferenceProfile, WorkspaceStatus } from "@vault/shared";
import { createCodeAgentLauncher } from "./agent/launcher.js";
import { MarkdownDefinitionLibrary } from "./agent/markdown-definition-library.js";
import { AgentService } from "./agent/service.js";
import { AgentStore } from "./agent/store.js";
import { AuditLog } from "./audit/log.js";
import {
  addFolderGrant,
  deleteConversationSession,
  warmConversationSession,
} from "./conversations/lifecycle.js";
import { ConversationStore } from "./conversations/store.js";
import { createFacade, type VaultCore, type VaultCorePorts } from "./facade.js";
import { JobStore } from "./jobs/jobs.js";
import { createInferenceService, unavailableInference } from "./runtime/compose.js";
import { configurePromptDirectory } from "./runtime/prompt-instructions.js";
import type { InferenceSupervisor } from "./runtime/supervisor.js";
import { ArtifactStore } from "./workspace/artifacts.js";
import { openWorkspaceCatalog } from "./workspace/catalog.js";
import { WorkspaceScope } from "./workspace/scope.js";
import { getOrCreateWorkspace } from "./workspace/workspaces.js";

export interface VaultCoreOptions {
  workspaceDir: string;
  modelStoreDir: string;
  profile: InferenceProfile;
  migrationDirectory?: string;
  sessionsOnly?: boolean;
  workerEntryPath?: string;
  inferenceHelperPath?: string;
  inferenceRuntimePath?: string;
  visionRuntimePath?: string;
  agentHelperPath?: string;
  agentImageRoot?: string;
  promptDirectory?: string;
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the explicit port list keeps each authority visible at assembly.
function createConversationPorts(
  conversations: ConversationStore,
  audit: AuditLog,
  database: ReturnType<typeof openWorkspaceCatalog>["database"],
  agent?: AgentService,
): Pick<
  VaultCorePorts,
  | "addFolder"
  | "listFolders"
  | "reorderFolders"
  | "resolveFolderPath"
  | "revokeFolder"
  | "createSession"
  | "deleteSession"
  | "listSessions"
  | "appendMessage"
  | "listMessages"
> {
  return {
    async addFolder(rootPath) {
      return addFolderGrant(conversations, audit, database, rootPath);
    },
    listFolders: async () => conversations.listFolders(),
    async reorderFolders(folderIds) {
      const folders = conversations.reorderFolders(folderIds);
      audit.append({
        type: "folders.reordered",
        outcome: "succeeded",
        metadata: { folderCount: folderIds.length },
      });
      return folders;
    },
    resolveFolderPath: async (folderId) => conversations.resolveFolderPath(folderId),
    async revokeFolder(folderId) {
      for (const sessionId of conversations.sessionIdsForFolder(folderId)) {
        await agent?.closeSession(sessionId);
      }
      const revoked = conversations.revokeFolder(folderId);
      audit.append({
        type: "folder.revoked",
        outcome: revoked ? "succeeded" : "failed",
        metadata: { folderId },
      });
      return revoked;
    },
    async createSession(folderId) {
      return database.transaction(() => {
        const session = conversations.createSession(folderId);
        audit.append({
          type: "session.created",
          outcome: "succeeded",
          metadata: { sessionId: session.id, folderId: session.folderId },
        });
        return session;
      })();
    },
    async deleteSession(sessionId) {
      await agent?.closeSession(sessionId);
      const deleted = deleteConversationSession(conversations, audit, database, sessionId);
      if (deleted) await agent?.closeSession(sessionId, true);
      return deleted;
    },
    async listSessions(folderId, cursor, limit) {
      return conversations.listSessions(folderId, cursor, limit);
    },
    async appendMessage(sessionId, role, content) {
      return database.transaction(() => {
        const entry = conversations.appendMessage(sessionId, role, content);
        audit.append({
          type: "message.appended",
          outcome: "succeeded",
          metadata: { sessionId, role },
        });
        return entry;
      })();
    },
    async listMessages(sessionId) {
      warmConversationSession(agent, audit, sessionId);
      return conversations.listMessages(sessionId);
    },
  };
}

interface CoreServices {
  catalog: ReturnType<typeof openWorkspaceCatalog>;
  workspace: WorkspaceStatus["workspace"];
  audit: AuditLog;
  jobs: JobStore;
  conversations: ConversationStore;
  agentStore: AgentStore;
  inference: InferenceSupervisor | ReturnType<typeof unavailableInference>;
  agent?: AgentService;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: facade assembly intentionally lists every public capability.
function assembleVaultCore(services: CoreServices): VaultCore {
  const { catalog, workspace, audit, jobs, conversations, agentStore, inference, agent } = services;
  const unavailableAgent = (): never => {
    throw Object.assign(new Error("agent_not_packaged"), { code: "unsupported" });
  };
  audit.append({ type: "core.opened", outcome: "succeeded", metadata: {} });
  return createFacade({
    status: async () => ({
      workspace,
      catalogSchemaVersion: catalog.schemaVersion,
      protocolVersion: 1,
      status: "ok",
    }),
    ...createConversationPorts(conversations, audit, catalog.database, agent),
    async saveDraft(sessionId, content) {
      return agent?.saveDraft(sessionId, content) ?? unavailableAgent();
    },
    async loadDraft(sessionId) {
      return agent?.loadDraft(sessionId) ?? unavailableAgent();
    },
    async addAttachment(sessionId, path) {
      return (await agent?.addAttachment(sessionId, path)) ?? unavailableAgent();
    },
    async listAttachments(sessionId) {
      return agent?.listAttachments(sessionId) ?? unavailableAgent();
    },
    async materializeAttachment(sessionId, attachmentId) {
      return (await agent?.materializeAttachment(sessionId, attachmentId)) ?? unavailableAgent();
    },
    async materializeArtifact(sessionId, artifactId) {
      return (await agent?.materializeArtifact(sessionId, artifactId)) ?? unavailableAgent();
    },
    async recordArtifactOpen(sessionId, artifactId, outcome) {
      const activeAgent = agent ?? unavailableAgent();
      await activeAgent.recordArtifactOpen(sessionId, artifactId, outcome);
    },
    async exportArtifact(sessionId, artifactId, destination) {
      const activeAgent = agent ?? unavailableAgent();
      await activeAgent.exportArtifact(sessionId, artifactId, destination);
    },
    async removeAttachment(sessionId, attachmentId) {
      return agent?.removeAttachment(sessionId, attachmentId) ?? unavailableAgent();
    },
    async startAgent(sessionId, task) {
      return agent?.start(sessionId, task) ?? unavailableAgent();
    },
    async listAgentRuns(sessionId) {
      return agent?.listRuns(sessionId) ?? unavailableAgent();
    },
    async getAgentRun(runId) {
      return agent?.snapshot(runId) ?? unavailableAgent();
    },
    getAgentTrace: async (runId) => agentStore.trace.get(runId),
    async cancelAgent(jobId) {
      return agent?.cancel(jobId) ?? false;
    },
    async answerQuestion(runId, questionId, answers) {
      return agent?.settleQuestion(runId, questionId, answers) ?? false;
    },
    async dismissQuestion(runId, questionId) {
      return agent?.settleQuestion(runId, questionId, undefined) ?? false;
    },
    async cancelJob(jobId) {
      const cancelled = agent?.cancel(jobId) ?? jobs.cancel(jobId) !== undefined;
      audit.append({
        type: "job.cancellation_requested",
        outcome: cancelled ? "succeeded" : "failed",
        metadata: { jobId },
      });
      return cancelled;
    },
    verifyAudit: async () => audit.verify(),
    generate: (input, signal, onThinkingDelta, identity) =>
      inference.generate(input, signal, onThinkingDelta, identity),
    chat: (input, signal, streams, identity) => inference.chat(input, signal, streams, identity),
    embed: (input, signal) => inference.embed(input, signal),
    inspectImage: (input, signal) => inference.inspectImage(input, signal),
    modelStatus: () => inference.modelStatus(),
    unloadModel: () => inference.unloadModel(),
    async close() {
      await agent?.close();
      await inference.close();
      audit.append({ type: "core.closed", outcome: "succeeded", metadata: {} });
      catalog.close();
    },
  });
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: composition remains one explicit authority wiring boundary.
export async function createVaultCore(options: VaultCoreOptions): Promise<VaultCore> {
  const promptDirectory = resolve(options.promptDirectory ?? "prompts");
  configurePromptDirectory(promptDirectory);
  const scope = await WorkspaceScope.create(resolve(options.workspaceDir));
  const workspaceRoot = scope.root;
  const catalog = openWorkspaceCatalog(workspaceRoot, {
    ...(options.migrationDirectory === undefined
      ? {}
      : { migrationDirectory: options.migrationDirectory }),
  });
  const workspace = getOrCreateWorkspace(catalog.database, workspaceRoot);
  const audit = new AuditLog(catalog.database);
  const jobs = new JobStore(catalog.database);
  const conversations = new ConversationStore(catalog.database);
  const artifacts = await ArtifactStore.create(scope);
  const agentStore = new AgentStore(catalog.database, artifacts, (event) => audit.append(event));
  agentStore.recoverInterrupted();
  let inference: InferenceSupervisor | ReturnType<typeof unavailableInference>;
  let inferenceAvailable = false;
  let agentSessionCapacity = 0;
  try {
    const configured =
      options.sessionsOnly === true
        ? { service: unavailableInference(), available: false as const, agentSessionCapacity: 0 }
        : await createInferenceService(options, workspaceRoot, audit);
    inference = configured.service;
    inferenceAvailable = configured.available;
    agentSessionCapacity = configured.agentSessionCapacity;
  } catch (error) {
    catalog.close();
    throw error;
  }
  const agent =
    options.sessionsOnly === true || !inferenceAvailable || options.agentHelperPath === undefined
      ? undefined
      : new AgentService(
          catalog.database,
          agentStore,
          conversations,
          jobs,
          artifacts,
          inference,
          createCodeAgentLauncher(
            options.agentHelperPath,
            options.agentImageRoot,
            resolve(workspaceRoot, ".vault", "agent-workspaces"),
          ),
          audit,
          agentSessionCapacity,
          new MarkdownDefinitionLibrary(promptDirectory),
        );
  const restoredSessionId = conversations.mostRecentSessionId();
  if (agent !== undefined && restoredSessionId !== undefined) {
    warmConversationSession(agent, audit, restoredSessionId);
  }
  return assembleVaultCore({
    catalog,
    workspace,
    audit,
    jobs,
    conversations,
    agentStore,
    inference,
    ...(agent === undefined ? {} : { agent }),
  });
}

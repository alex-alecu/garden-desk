import type { AgentRunSnapshot, ConversationMessage, SessionSummary } from "@vault/shared";
import {
  AgentRunSnapshotSchema,
  AgentRunSummarySchema,
  AgentTraceSchema,
  ConversationMessageSchema,
  SessionDraftSchema,
  SessionSummarySchema,
} from "@vault/shared";
import type { DesktopApi } from "../../packages/desktop/src/api.js";
import { responseFor } from "./demo-content.js";
import {
  createRunSummary,
  demoEvents,
  demoExecution,
  demoPerformance,
  demoState,
  demoTime,
  uuid,
} from "./demo-run.js";
import { financeSession, folder, initialRun, sampleMessages, sessions } from "./fixtures.js";

const demoUnavailable = () => Promise.reject(new Error("Unavailable in the public demo"));
const limitation =
  "The public demo does not run a model or send your text anywhere. Choose one of the guided examples above to see a deterministic sample result.";

interface DynamicRun {
  polls: number;
  response: string;
  snapshot: AgentRunSnapshot;
  completed: boolean;
}

export class DemoDesktopApi implements DesktopApi {
  private readonly messages = new Map<string, ConversationMessage[]>(
    [...sampleMessages].map(([sessionId, items]) => [sessionId, [...items]]),
  );
  private readonly runs = new Map<string, DynamicRun>();
  private readonly sessionList: SessionSummary[] = [...sessions];
  private sequence = 100;

  async bootstrapDesktop() {
    return {
      catalogPath: "browser-memory://synthetic-demo",
      folders: [folder],
      globalSessions: { items: [], nextCursor: null },
      folderSessions: [
        { folderId: folder.id, page: { items: this.sessionList, nextCursor: null } },
      ],
      initialSessionId: financeSession.id,
      model: await this.getModelStatus(),
    };
  }

  async getSecureWorkspaceStatus() {
    return { state: "ready" as const };
  }

  async configureSecureWorkspace() {
    return {
      outcome: "not_needed" as const,
      status: { state: "ready" as const },
    };
  }

  async getModelStatus() {
    return {
      modelId: "public-demo",
      name: "Vault Desk demo",
      state: "ready" as const,
      message: "Synthetic responses only",
      thinkingSupported: false,
    };
  }

  unloadModel = demoUnavailable;
  chooseFolder = demoUnavailable;
  classifyDroppedPaths = demoUnavailable;
  addFolders = demoUnavailable;
  reorderFolders = demoUnavailable;
  revokeFolder = demoUnavailable;
  openFolder = demoUnavailable;
  deleteSession = demoUnavailable;
  chooseFiles = demoUnavailable;
  addFiles = demoUnavailable;
  openAttachment = demoUnavailable;
  openArtifact = demoUnavailable;
  saveArtifact = demoUnavailable;
  removeAttachment = demoUnavailable;
  answerQuestion = demoUnavailable;
  dismissQuestion = demoUnavailable;
  createDebugSnapshot = demoUnavailable;
  revealDebugSnapshot = demoUnavailable;

  async createSession(folderId: string | null) {
    this.sequence += 1;
    const session = SessionSummarySchema.parse({
      id: uuid(2, this.sequence),
      folderId,
      title: "New chat",
      createdAt: demoTime,
      updatedAt: demoTime,
    });
    this.sessionList.unshift(session);
    this.messages.set(session.id, []);
    return session;
  }

  async listSessions(folderId: string | null) {
    return {
      items: this.sessionList.filter((session) => session.folderId === folderId),
      nextCursor: null,
    };
  }

  async listMessages(sessionId: string) {
    return [...(this.messages.get(sessionId) ?? [])];
  }

  async appendUserMessage(sessionId: string, content: string) {
    const message = ConversationMessageSchema.parse({
      id: uuid(5, ++this.sequence),
      sessionId,
      role: "user",
      content,
      runId: null,
      createdAt: demoTime,
    });
    this.messages.set(sessionId, [...(this.messages.get(sessionId) ?? []), message]);
    return message;
  }

  async listAttachments() {
    return [];
  }

  async saveDraft(sessionId: string, content: string) {
    return SessionDraftSchema.parse({ sessionId, content, updatedAt: demoTime });
  }

  async loadDraft() {
    return undefined;
  }

  async startAgent(sessionId: string, task: string) {
    const user = await this.appendUserMessage(sessionId, task);
    const summary = createRunSummary(sessionId, ++this.sequence);
    const sampleResponse = responseFor(task);
    const response = sampleResponse ?? limitation;
    const guided = sampleResponse !== undefined;
    const run = guided
      ? summary
      : AgentRunSummarySchema.parse({
          ...summary,
          state: "succeeded",
          response,
          performance: null,
        });
    const messages = this.messages.get(sessionId) ?? [user];
    if (!guided) {
      this.messages.set(sessionId, [
        ...messages,
        this.assistantMessage(sessionId, run.id, response),
      ]);
    }
    this.runs.set(run.id, {
      polls: 0,
      response,
      completed: !guided,
      snapshot: AgentRunSnapshotSchema.parse({
        run,
        events: demoEvents(run.id, run.state),
        executions: [],
        artifacts: [],
        thinking: null,
      }),
    });
    return run;
  }

  private assistantMessage(sessionId: string, runId: string, content: string): ConversationMessage {
    return ConversationMessageSchema.parse({
      id: uuid(5, ++this.sequence),
      sessionId,
      role: "assistant",
      content,
      runId,
      createdAt: demoTime,
    });
  }

  async getAgentRun(runId: string) {
    if (runId === initialRun.run.id) return initialRun;
    const dynamic = this.runs.get(runId);
    if (dynamic === undefined) throw new Error("Unknown demo run");
    if (dynamic.completed) return dynamic.snapshot;
    dynamic.polls += 1;
    const state = demoState(dynamic.polls);
    const run = AgentRunSummarySchema.parse({
      ...dynamic.snapshot.run,
      state,
      response: state === "succeeded" ? dynamic.response : null,
      performance: demoPerformance(state),
    });
    dynamic.snapshot = AgentRunSnapshotSchema.parse({
      run,
      events: demoEvents(runId, state),
      executions: state === "succeeded" ? [demoExecution(runId)] : [],
      artifacts: [],
      thinking: state === "running" ? "Formatting a fixed synthetic example…" : null,
    });
    if (state === "succeeded") {
      dynamic.completed = true;
      const messages = this.messages.get(run.sessionId) ?? [];
      this.messages.set(run.sessionId, [
        ...messages,
        this.assistantMessage(run.sessionId, run.id, dynamic.response),
      ]);
    }
    return dynamic.snapshot;
  }

  // The demo runs no model, so no prompt or decision was ever recorded for a run.
  async getAgentTrace(runId: string) {
    return AgentTraceSchema.parse({ runId, captureVersion: 0, status: "not_recorded", turns: [] });
  }

  async listAgentRuns(sessionId: string) {
    const runs = [...this.runs.values()]
      .map((item) => item.snapshot.run)
      .filter((run) => run.sessionId === sessionId);
    return sessionId === initialRun.run.sessionId ? [initialRun.run, ...runs] : runs;
  }

  async cancelAgent() {
    return true;
  }
}

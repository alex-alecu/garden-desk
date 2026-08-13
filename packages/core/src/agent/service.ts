import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  AgentRunSnapshot,
  AgentRunSummary,
  AgentTrace,
  AttachmentSummary,
  SessionDraft,
} from "@vault/shared";
import type { CodeAgentLauncher } from "@vault/workers";
import type { AuditLog } from "../audit/log.js";
import type { ConversationStore } from "../conversations/store.js";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { ArtifactStore } from "../workspace/artifacts.js";
import type { DatabasePort } from "../workspace/database.js";
import { askRunQuestion, settleActiveQuestion } from "./agent-questions.js";
import { ArtifactMaterializer } from "./artifact-materialization.js";
import { prepareArtifacts } from "./artifact-results.js";
import { materializeAndAuditAttachment } from "./attachment-materialization.js";
import { AgentInputResolver } from "./inputs.js";
import { AGENT_MODEL_ID, AGENT_WORKER_LIMITS } from "./limits.js";
import { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { runPrimaryAgent } from "./primary-run.js";
import { AgentRunCapacity } from "./run-capacity.js";
import { type ActiveRun, withActiveRun } from "./service-active.js";
import { agentFailureEvent, agentFailureText, runPerformance } from "./service-results.js";
import { AgentSessionManager } from "./session-manager.js";
import { refreshSessionSummary } from "./session-summary.js";
import { SessionSummaryStore } from "./session-summary-store.js";
import type { AgentStore } from "./store.js";

export class AgentService {
  private readonly active = new Map<string, ActiveRun>();
  private closed = false;
  private readonly artifactMaterializer: ArtifactMaterializer;
  private readonly sessions: AgentSessionManager;
  private readonly runCapacity: AgentRunCapacity;
  private readonly summaries: SessionSummaryStore;

  // biome-ignore lint/complexity/useMaxParams: explicit ports keep security authorities visible at construction.
  constructor(
    private readonly database: DatabasePort,
    private readonly store: AgentStore,
    private readonly conversations: ConversationStore,
    private readonly jobs: JobStore,
    private readonly artifacts: ArtifactStore,
    private readonly inference: Partial<
      Pick<InferenceService, "chat" | "generate" | "modelStatus">
    >,
    launcher: CodeAgentLauncher,
    private readonly audit: AuditLog,
    maximumConcurrentRuns = 1,
    private readonly definitions = new MarkdownDefinitionLibrary(resolve(process.cwd(), "prompts")),
  ) {
    this.artifactMaterializer = new ArtifactMaterializer(database, artifacts, audit);
    this.summaries = new SessionSummaryStore(database);
    this.sessions = new AgentSessionManager(
      launcher,
      new AgentInputResolver(database, store),
      AGENT_WORKER_LIMITS,
      maximumConcurrentRuns,
    );
    this.runCapacity = new AgentRunCapacity(maximumConcurrentRuns);
  }

  saveDraft(sessionId: string, content: string): SessionDraft {
    return this.store.saveDraft(sessionId, content);
  }

  loadDraft(sessionId: string): SessionDraft | undefined {
    return this.store.loadDraft(sessionId);
  }

  async addAttachment(sessionId: string, path: string): Promise<AttachmentSummary> {
    if ([...this.active.values()].some((run) => run.sessionId === sessionId))
      throw new Error("agent_busy");
    const item = await this.store.addAttachment(sessionId, path);
    await this.sessions.closeSession(sessionId);
    this.audit.append({
      type: "attachment.added",
      outcome: "succeeded",
      metadata: { sessionId, attachmentId: item.id, byteLength: item.byteLength },
    });
    return item;
  }

  listAttachments(sessionId: string): AttachmentSummary[] {
    return this.store.listAttachments(sessionId);
  }
  async materializeAttachment(sessionId: string, attachmentId: string): Promise<string> {
    return await materializeAndAuditAttachment(this.store, this.audit, sessionId, attachmentId);
  }
  async materializeArtifact(sessionId: string, artifactId: string): Promise<string> {
    return await this.artifactMaterializer.materialize(sessionId, artifactId);
  }
  async recordArtifactOpen(sessionId: string, artifactId: string, outcome: "failed" | "succeeded") {
    this.artifactMaterializer.recordOpen(sessionId, artifactId, outcome);
  }
  async exportArtifact(sessionId: string, artifactId: string, destination: string): Promise<void> {
    await this.artifactMaterializer.export(sessionId, artifactId, destination);
  }
  async removeAttachment(sessionId: string, attachmentId: string): Promise<boolean> {
    if ([...this.active.values()].some((run) => run.sessionId === sessionId))
      throw new Error("agent_busy");
    const removed = this.store.removeAttachment(sessionId, attachmentId);
    if (removed) await this.sessions.closeSession(sessionId);
    this.audit.append({
      type: "attachment.removed",
      outcome: removed ? "succeeded" : "failed",
      metadata: { sessionId, attachmentId },
    });
    return removed;
  }

  start(sessionId: string, task: string): AgentRunSummary {
    if (this.closed) throw new Error("agent_service_closed");
    if ([...this.active.values()].some((run) => run.sessionId === sessionId))
      throw new Error("agent_busy");
    const run = this.database.transaction(() => {
      this.conversations.appendMessage(sessionId, "user", task);
      this.store.saveDraft(sessionId, "");
      const job = this.jobs.create("agent", randomUUID());
      return this.store.createRun(sessionId, job.id);
    })();
    const controller = new AbortController();
    const finished = Promise.resolve()
      .then(async () => await this.execute(run, task, controller.signal))
      .finally(() => {
        this.active.delete(run.jobId);
      });
    this.active.set(run.jobId, {
      controller,
      finished,
      runId: run.id,
      sessionId: run.sessionId,
      thinking: null,
    });
    return run;
  }

  snapshot(runId: string): AgentRunSnapshot {
    const snapshot = this.store.snapshot(runId);
    const active = [...this.active.values()].find((run) => run.runId === runId);
    return withActiveRun(snapshot, active);
  }
  settleQuestion = (runId: string, questionId: string, answers?: string[][]): boolean =>
    settleActiveQuestion(this.active, runId, questionId, answers);
  private updateActive(jobId: string, patch: Partial<ActiveRun>): void {
    const run = this.active.get(jobId);
    if (run !== undefined) Object.assign(run, patch);
  }
  listRuns(sessionId: string): AgentRunSummary[] {
    return this.store.listRuns(sessionId);
  }
  async trace(runId: string): Promise<AgentTrace> {
    return await this.store.trace.get(runId);
  }
  private async contextTokens(): Promise<number | "auto"> {
    try {
      return (await this.inference.modelStatus?.())?.contextSizeTokens ?? "auto";
    } catch {
      return "auto";
    }
  }
  warmSession(sessionId: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("agent_service_closed"));
    if ([...this.active.values()].some((run) => run.sessionId === sessionId))
      return Promise.resolve();
    return this.sessions.warmSession(sessionId);
  }
  async closeSession(sessionId: string, deleteWorkspace = false): Promise<void> {
    const active = [...this.active.values()].find((run) => run.sessionId === sessionId);
    if (active !== undefined) {
      active.controller.abort(new DOMException("Session closed.", "AbortError"));
      await active.finished;
    }
    await this.sessions.closeSession(sessionId, deleteWorkspace);
  }
  cancel(jobId: string): boolean {
    const active = this.active.get(jobId);
    const cancelled = this.jobs.cancel(jobId) !== undefined;
    active?.controller.abort(new DOMException("Agent run cancelled.", "AbortError"));
    return cancelled;
  }
  private failRun(run: AgentRunSummary, signal: AbortSignal, error: unknown): void {
    const cancelled = signal.aborted || this.jobs.isCancellationRequested(run.jobId);
    const state = cancelled ? "cancelled" : "failed";
    const detail = cancelled ? "cancelled" : agentFailureText(error);
    const event = agentFailureEvent(cancelled, detail);
    this.updateActive(run.jobId, { thinking: null });
    this.database.transaction(() => {
      this.store.execution.failIncomplete(run.id, cancelled);
      this.store.transitionRun(run.id, { state, error: detail });
      if (!cancelled) this.jobs.transition(run.jobId, "failed");
      this.store.appendEvent(run.id, event.type, event.summary, event.detail);
    })();
    this.audit.append({
      type: "agent.completed",
      outcome: "failed",
      metadata: { runId: run.id, jobId: run.jobId, code: detail },
    });
  }
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: the run lifecycle stays linear so cleanup and terminal persistence remain paired.
  private async execute(run: AgentRunSummary, task: string, signal: AbortSignal): Promise<void> {
    let releaseCapacity: (() => void) | undefined;
    try {
      releaseCapacity = await this.runCapacity.acquire(signal);
      signal.throwIfAborted();
      this.database.transaction(() => {
        this.jobs.transition(run.jobId, "running");
        this.store.transitionRun(run.id, { state: "running" });
        this.store.appendEvent(
          run.id,
          "run.started",
          "Offline limits: live read-only source, 40 model turns, 24 guest executions, 120 seconds each, 4 CPUs, 4 GiB memory, and a persistent 128 MiB workspace.",
        );
      })();
      const messages = this.conversations.listMessages(run.sessionId);
      const anchored = this.summaries.load(run.sessionId);
      const history = {
        messages:
          anchored === undefined
            ? messages.slice(0, -1)
            : messages.slice(anchored.coveredMessageCount, -1),
        ...(anchored === undefined ? {} : { summary: anchored.text }),
      };
      const contextTokens = "auto" as const;
      if (this.inference.chat === undefined) throw new Error("agent_chat_unavailable");
      const chat = this.inference.chat.bind(this.inference);
      const result = await runPrimaryAgent({
        chat,
        contextTokens,
        database: this.database,
        definitions: this.definitions,
        history,
        jobs: this.jobs,
        onThinking: (thinking) => this.updateActive(run.jobId, { thinking }),
        onContext: (contextUsedTokens, contextAllocatedTokens) =>
          this.updateActive(run.jobId, { contextUsedTokens, contextAllocatedTokens }),
        askQuestion: (questions) =>
          askRunQuestion({ active: this.active, store: this.store, run, signal, questions }),
        run,
        sessions: this.sessions,
        signal,
        store: this.store,
        task,
      });
      const performance = runPerformance(result, run.createdAt);
      this.updateActive(run.jobId, { thinking: null });
      const deliverables = await prepareArtifacts(
        result.artifacts,
        result.executions,
        this.artifacts,
      );
      this.database.transaction(() => {
        this.conversations.appendMessage(run.sessionId, "assistant", result.response, run.id);
        for (const deliverable of deliverables) this.store.addArtifact(run.id, deliverable);
        this.store.transitionRun(run.id, {
          state: "succeeded",
          response: result.response,
          performance,
        });
        this.jobs.transition(run.jobId, "succeeded");
      })();
      this.audit.append({
        type: "agent.completed",
        outcome: "succeeded",
        metadata: { runId: run.id, jobId: run.jobId, executions: result.executions.length },
      });
      const summaryContextTokens = await this.contextTokens();
      await refreshSessionSummary(
        { chat },
        {
          sessionId: run.sessionId,
          runId: run.id,
          contextTokens: summaryContextTokens === "auto" ? 8_192 : summaryContextTokens,
          loadMessages: () => this.conversations.listMessages(run.sessionId),
          modelId: AGENT_MODEL_ID,
          library: this.definitions,
          store: this.summaries,
          signal,
          trace: { runId: run.id, store: this.store.trace },
        },
      );
    } catch (error) {
      this.failRun(run, signal, error);
    } finally {
      releaseCapacity?.();
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    const active = [...this.active.values()];
    for (const run of active) run.controller.abort(new DOMException("Core closed.", "AbortError"));
    await Promise.all(active.map((run) => run.finished));
    await this.sessions.close();
  }
}

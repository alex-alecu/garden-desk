import { randomUUID } from "node:crypto";
import type {
  AgentRunPerformance,
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
import { prepareDeclaredArtifacts } from "./artifact-declarations.js";
import { ArtifactMaterializer } from "./artifact-materialization.js";
import { materializeAndAuditAttachment } from "./attachment-materialization.js";
import { resolveAgentTask } from "./continuation.js";
import { historyForSession } from "./history.js";
import { AgentInputResolver } from "./inputs.js";
import { AGENT_MODEL_ID, AGENT_WORKER_LIMITS } from "./limits.js";
import { AgentLoop } from "./loop.js";
import { defaultPromptLibrary, type PromptLibrary } from "./prompt-library.js";
import { AgentRunCapacity } from "./run-capacity.js";
import type { ActiveRun } from "./service-active.js";
import { agentFailureEvent, agentFailureText, tokenRate } from "./service-results.js";
import { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";

export class AgentService {
  private readonly active = new Map<string, ActiveRun>();
  private closed = false;
  private readonly artifactMaterializer: ArtifactMaterializer;
  private readonly sessions: AgentSessionManager;
  private readonly runCapacity: AgentRunCapacity;

  // biome-ignore lint/complexity/useMaxParams: explicit ports keep security authorities visible at construction.
  constructor(
    private readonly database: DatabasePort,
    private readonly store: AgentStore,
    private readonly conversations: ConversationStore,
    private readonly jobs: JobStore,
    private readonly artifacts: ArtifactStore,
    private readonly inference: Pick<InferenceService, "generate"> &
      Partial<Pick<InferenceService, "modelStatus">>,
    launcher: CodeAgentLauncher,
    private readonly audit: AuditLog,
    maximumConcurrentRuns = 1,
    private readonly promptLibrary: PromptLibrary = defaultPromptLibrary(),
  ) {
    this.artifactMaterializer = new ArtifactMaterializer(database, artifacts, audit);
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
    const thinking = [...this.active.values()].find((run) => run.runId === runId)?.thinking ?? null;
    return { ...snapshot, thinking };
  }
  listRuns(sessionId: string): AgentRunSummary[] {
    return this.store.listRuns(sessionId);
  }
  async trace(runId: string): Promise<AgentTrace> {
    return await this.store.trace.get(runId);
  }
  private async contextTokens(): Promise<number> {
    try {
      return (await this.inference.modelStatus?.())?.contextSizeTokens ?? 8_192;
    } catch {
      return 8_192;
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
          "Offline limits: live read-only source, 6 executions, 120 seconds each, 4 CPUs, 4 GiB memory, and a persistent 128 MiB workspace.",
        );
      })();
      const messages = this.conversations.listMessages(run.sessionId);
      const history = {
        messages: messages.slice(0, -1),
        runs: historyForSession(this.database, run.sessionId, run.id),
      };
      const resolvedTask = resolveAgentTask(task, history);
      const contextTokens = await this.contextTokens();
      const loop = new AgentLoop(
        this.inference,
        {
          execute: async (input, executionSignal) => {
            const execution = this.store.execution.create(run.id, input);
            const result = await this.sessions.execute(run.sessionId, input, executionSignal, {
              executionId: execution.id,
              onUpdate: (update) => {
                if (update.kind === "stream") {
                  this.store.execution.appendStream(execution.id, update.stream, update.bytes);
                  return;
                }
                this.store.execution.appendDiagnostic(execution.id, update);
              },
            });
            this.store.execution.complete(execution.id, result);
            return result;
          },
        },
        contextTokens,
      );
      const result = await loop.run({
        task: resolvedTask.task,
        continuation: resolvedTask.continuation,
        modelId: AGENT_MODEL_ID,
        inputNames: this.store.listAttachments(run.sessionId).map((item) => item.name),
        history,
        promptLibrary: this.promptLibrary,
        signal,
        onThinking: (thinking) => {
          const active = this.active.get(run.jobId);
          if (active !== undefined) active.thinking = thinking;
        },
        trace: { runId: run.id, store: this.store.trace },
        onEvent: (type, summary, detail) => this.store.appendEvent(run.id, type, summary, detail),
      });
      const performance: AgentRunPerformance = {
        promptTokens: result.inference.promptTokens,
        outputTokens: result.inference.outputTokens,
        tokensPerSecond: tokenRate(
          result.inference.outputTokens,
          result.inference.generationDurationMs,
        ),
        promptTokensPerSecond: tokenRate(
          result.inference.promptTokens,
          result.inference.promptDurationMs,
        ),
        totalDurationMs: Math.max(0, Date.now() - Date.parse(run.createdAt)),
      };
      const active = this.active.get(run.jobId);
      if (active !== undefined) active.thinking = null;
      const deliverables = await prepareDeclaredArtifacts(
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
    } catch (error) {
      const cancelled = signal.aborted || this.jobs.isCancellationRequested(run.jobId);
      const state = cancelled ? "cancelled" : "failed";
      const detail = cancelled ? "cancelled" : agentFailureText(error);
      const event = agentFailureEvent(cancelled, detail);
      const active = this.active.get(run.jobId);
      if (active !== undefined) active.thinking = null;
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

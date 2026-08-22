import type { AgentRunSummary } from "@vault/shared";
import type { AuditLog } from "../audit/log.js";
import type { ConversationStore } from "../conversations/store.js";
import type { InferenceService } from "../runtime/inference.js";
import { AGENT_MODEL_ID } from "./limits.js";
import type { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { refreshSessionSummary } from "./session-summary.js";
import type { SessionSummaryStore } from "./session-summary-store.js";
import type { AgentStore } from "./store.js";

export class SessionSummaryQueue {
  private readonly lifecycle = new AbortController();
  private readonly pending = new Set<Promise<void>>();
  private readonly tails = new Map<string, Promise<void>>();
  // biome-ignore lint/complexity/useMaxParams: explicit ports retain the summary boundary.
  constructor(
    private readonly inference: Partial<Pick<InferenceService, "chat">>,
    private readonly conversations: ConversationStore,
    private readonly library: MarkdownDefinitionLibrary,
    private readonly store: AgentStore,
    private readonly audit: AuditLog,
    private readonly summaries: SessionSummaryStore,
  ) {}

  enqueue(run: AgentRunSummary, signal: AbortSignal, measuredContextTokens?: number): void {
    if (measuredContextTokens === undefined) return;
    const refreshSignal = AbortSignal.any([signal, this.lifecycle.signal]);
    const work = (this.tails.get(run.sessionId) ?? Promise.resolve())
      .then(async () => await this.refresh(run, refreshSignal, measuredContextTokens))
      .catch(() => this.recordFailure(run));
    this.tails.set(run.sessionId, work);
    this.pending.add(work);
    void work.then(() => this.complete(run.sessionId, work));
  }

  async waitFor(sessionId: string, signal: AbortSignal): Promise<void> {
    const waitSignal = AbortSignal.any([signal, this.lifecycle.signal]);
    const work = this.tails.get(sessionId);
    if (work === undefined) return waitSignal.throwIfAborted();
    await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        waitSignal.addEventListener("abort", () => reject(waitSignal.reason), { once: true });
      }),
    ]);
    waitSignal.throwIfAborted();
  }

  async close(): Promise<void> {
    this.lifecycle.abort(new DOMException("Service closed.", "AbortError"));
    await Promise.all([...this.pending]);
  }

  private async refresh(
    run: AgentRunSummary,
    signal: AbortSignal,
    measuredContextTokens: number,
  ): Promise<void> {
    if (this.inference.chat === undefined) throw new Error("agent_chat_unavailable");
    await refreshSessionSummary(
      { chat: this.inference.chat.bind(this.inference) },
      {
        sessionId: run.sessionId,
        runId: run.id,
        contextTokens: measuredContextTokens,
        loadMessages: () => this.conversations.listMessages(run.sessionId),
        modelId: AGENT_MODEL_ID,
        library: this.library,
        store: this.summaries,
        signal,
        trace: { runId: run.id, store: this.store.trace },
      },
    );
  }

  private complete(sessionId: string, work: Promise<void>): void {
    this.pending.delete(work);
    if (this.tails.get(sessionId) === work) this.tails.delete(sessionId);
  }

  private recordFailure(run: AgentRunSummary): void {
    try {
      this.audit.append({
        type: "agent.session_summary",
        outcome: "failed",
        metadata: { runId: run.id, sessionId: run.sessionId },
      });
    } catch {}
  }
}

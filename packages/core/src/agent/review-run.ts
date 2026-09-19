import { randomUUID } from "node:crypto";
import type { AgentRunResult, AgentRunSummary } from "@gardendesk/shared";
import { reviewDocument } from "../commands/document-review.js";
import type { CommandInvocation } from "../commands/library.js";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import { AgentExecutionAttemptError } from "./agent-executor.js";
import type { ChatAgentInput } from "./chat-loop-input.js";
import type { ToolExecutionResult } from "./generic-tool-support.js";
import { createRunExecutor } from "./service-executor.js";
import { runPerformance } from "./service-results.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";

export interface InternalReviewPorts {
  database: DatabasePort;
  jobs: JobStore;
  parentRunId: string;
  sessionId: string;
  sessions: AgentSessionManager;
  store: AgentStore;
  toolCallId?: string;
}

function createReviewChild(ports: InternalReviewPorts, assignment: string): AgentRunSummary {
  return ports.database.transaction(() => {
    const job = ports.jobs.create("agent", randomUUID());
    const run = ports.store.createRun(ports.sessionId, job.id, ports.parentRunId, {
      agentId: "document-review",
      assignment,
      parentToolCallId: ports.toolCallId ?? null,
    });
    ports.jobs.transition(job.id, "running");
    ports.store.transitionRun(run.id, { state: "running" });
    return run;
  })();
}

function completeReviewChild(
  ports: InternalReviewPorts,
  child: AgentRunSummary,
  result: AgentRunResult,
): void {
  ports.database.transaction(() => {
    ports.store.transitionRun(child.id, {
      state: "succeeded",
      response: result.response,
      performance: runPerformance(result, child.createdAt),
    });
    ports.jobs.transition(child.jobId, "succeeded");
  })();
}

function failReviewChild(
  ports: InternalReviewPorts,
  child: AgentRunSummary,
  signal: AbortSignal | undefined,
  error: unknown,
): void {
  const cancelled = signal?.aborted === true;
  const detail = error instanceof Error ? error.message : "agent_review_failed";
  ports.database.transaction(() => {
    ports.store.execution.failIncomplete(child.id, cancelled);
    ports.store.transitionRun(child.id, {
      state: cancelled ? "cancelled" : "failed",
      error: detail,
    });
    if (cancelled) ports.jobs.cancel(child.jobId);
    else ports.jobs.transition(child.jobId, "failed");
    ports.store.appendEvent(
      child.id,
      cancelled ? "run.cancelled" : "run.failed",
      cancelled ? "Task cancelled." : "The review could not be completed.",
      { stderr: detail },
    );
  })();
}

/** Builds the review input so its steps, findings, and trace stay on the child run. */
function childReviewInput(
  ports: InternalReviewPorts,
  input: ChatAgentInput,
  child: AgentRunSummary,
  output: ToolExecutionResult,
): Omit<ChatAgentInput, "task"> {
  const executor = createRunExecutor({
    runId: child.id,
    sessionId: ports.sessionId,
    store: ports.store,
    sessions: ports.sessions,
  });
  return {
    agent: input.agent,
    contextTokens: input.contextTokens,
    modelId: input.modelId,
    skills: input.skills,
    systemPrompt: input.systemPrompt,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    trace: { runId: child.id, store: ports.store.trace },
    onEvent: (type, summary, detail) => ports.store.appendEvent(child.id, type, summary, detail),
    onThinking: (thinking) => ports.store.live.setThinking(child.id, thinking),
    onResponse: (response) => ports.store.live.setResponse(child.id, response),
    executor: {
      async execute(request, signal) {
        const result = await executor.execute(request, signal, () => {
          output.guestExecutionsStarted = 1;
        });
        output.guestExecutionsStarted = 1;
        return result;
      },
    },
  };
}

/**
 * Runs the packaged review workflow as a child run, so its extraction, model call, and findings
 * stay visible under the parent's review step instead of inside an opaque tool call.
 */
export async function runInternalReview(request: {
  ports: InternalReviewPorts;
  command: CommandInvocation;
  input: ChatAgentInput;
  chat: InferenceService["chat"];
  path: string;
}): Promise<ToolExecutionResult> {
  const { ports, command, input, chat, path } = request;
  const child = createReviewChild(ports, command.arguments);
  const directory = `.garden-desk-tools/review-${child.id}`;
  const output: ToolExecutionResult = { content: "", failed: false, guestExecutionsStarted: 0 };
  try {
    const result = await reviewDocument(
      command,
      { ...childReviewInput(ports, input, child, output), task: command.arguments },
      chat,
      { attachment: { path, displayName: path }, directory },
    );
    completeReviewChild(ports, child, result);
    output.content = JSON.stringify({
      source: path,
      extractedTextPath: `/workspace/${directory}/review-extracted.txt`,
      findings: result.response,
    });
  } catch (error) {
    failReviewChild(ports, child, input.signal, error);
    input.signal?.throwIfAborted();
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    output.failed = true;
    output.content = error instanceof Error ? error.message : String(error);
    if (error instanceof AgentExecutionAttemptError) output.executionAttempt = error.attempt;
  }
  return output;
}

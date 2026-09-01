import { randomUUID } from "node:crypto";
import type { AgentRunResult } from "@gardendesk/shared";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import { ChatAgentLoop } from "./chat-loop.js";
import type { SubagentRequest } from "./generic-tools.js";
import type { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { createRunExecutor } from "./service-executor.js";
import { runPerformance } from "./service-results.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";

interface SubagentPorts {
  contextTokens: number | "auto";
  knownContextTokens?: number;
  database: DatabasePort;
  inference: Pick<InferenceService, "chat">;
  inspectImage(path: string, prompt: string): Promise<string>;
  jobs: JobStore;
  library: MarkdownDefinitionLibrary;
  modelId: string;
  parentRunId: string;
  sessionId: string;
  sessions: AgentSessionManager;
  signal: AbortSignal;
  store: AgentStore;
}

function createChild(ports: SubagentPorts, request: SubagentRequest) {
  return ports.database.transaction(() => {
    const job = ports.jobs.create("agent", randomUUID());
    const run = ports.store.createRun(ports.sessionId, job.id, ports.parentRunId);
    ports.jobs.transition(job.id, "running");
    ports.store.transitionRun(run.id, { state: "running" });
    ports.store.appendEvent(
      run.id,
      "run.started",
      `Isolated ${request.subagentType} task started.`,
    );
    return run;
  })();
}

function failChild(
  ports: SubagentPorts,
  child: ReturnType<typeof createChild>,
  error: unknown,
): void {
  const cancelled = ports.signal.aborted;
  const detail = error instanceof Error ? error.message : "subagent_failed";
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
      cancelled ? "Task cancelled." : "Sub-agent failed.",
      { stderr: detail },
    );
  })();
}

function skillReader(library: MarkdownDefinitionLibrary) {
  return {
    metadata: () => [...library.skills],
    read: (name: string) => library.skill(name).body,
  };
}

export async function runSubagent(
  ports: SubagentPorts,
  request: SubagentRequest,
): Promise<Pick<AgentRunResult, "response" | "executions">> {
  const child = createChild(ports, request);
  try {
    const result = await new ChatAgentLoop(ports.inference).run({
      agent: ports.library.agent(request.subagentType),
      contextTokens: ports.contextTokens,
      ...(ports.knownContextTokens === undefined
        ? {}
        : { knownContextTokens: ports.knownContextTokens }),
      executor: createRunExecutor({
        runId: child.id,
        sessionId: ports.sessionId,
        store: ports.store,
        sessions: ports.sessions,
      }),
      modelId: ports.modelId,
      onEvent: (type, summary, detail) => ports.store.appendEvent(child.id, type, summary, detail),
      signal: ports.signal,
      inferencePriority: "secondary",
      ...(request.subagentType === "general" ? { inspectImage: ports.inspectImage } : {}),
      skills: skillReader(ports.library),
      systemPrompt: (name) => ports.library.system(name),
      task: `${request.description}\n\n${request.prompt}`,
      trace: { runId: child.id, store: ports.store.trace },
    });
    ports.database.transaction(() => {
      ports.store.transitionRun(child.id, {
        state: "succeeded",
        response: result.response,
        performance: runPerformance(result, child.createdAt),
      });
      ports.jobs.transition(child.jobId, "succeeded");
    })();
    return { response: result.response, executions: result.executions };
  } catch (error) {
    failChild(ports, child, error);
    throw error;
  }
}

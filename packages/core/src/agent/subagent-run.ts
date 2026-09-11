import { randomUUID } from "node:crypto";
import type { AgentRunResult, AgentRunSummary } from "@gardendesk/shared";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import { ChatAgentLoop } from "./chat-loop.js";
import type { SubagentRequest } from "./generic-tools.js";
import { guestAttachmentName } from "./inputs.js";
import type { AgentDefinition, MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
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
  outputOwner?: "parent" | "user";
  modelNeedsLoad?: boolean;
  onResponse?(text: string | null): void;
  onContext?(used: number, allocated: number, measured?: boolean): void;
}

function createChild(ports: SubagentPorts, request: SubagentRequest) {
  return ports.database.transaction(() => {
    const job = ports.jobs.create("agent", randomUUID());
    const run = ports.store.createRun(ports.sessionId, job.id, ports.parentRunId, {
      agentId: request.subagentType,
      assignment: request.description,
      parentToolCallId: request.parentToolCallId ?? null,
    });
    ports.jobs.transition(job.id, "running");
    ports.store.transitionRun(run.id, { state: "running" });
    ports.store.appendEvent(run.id, "run.started", request.description);
    commandEvent(ports, run, "subagent.started", request.description);
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
    commandEvent(
      ports,
      child,
      "subagent.completed",
      cancelled ? "Task cancelled." : "Specialist failed.",
    );
  })();
}

function commandEvent(
  ports: SubagentPorts,
  child: AgentRunSummary,
  type: "subagent.started" | "subagent.completed",
  summary: string,
): void {
  if (ports.outputOwner === "user")
    ports.store.appendEvent(ports.parentRunId, type, summary, {
      toolName: "task",
      toolCallId: child.parentToolCallId ?? null,
    });
}

function childDefinition(ports: SubagentPorts, definition: AgentDefinition, childId: string) {
  if (["general", "explore"].includes(definition.name)) return definition;
  const workDirectory = `/workspace/.garden-desk-tools/${childId}`;
  const ownership =
    ports.outputOwner === "user"
      ? "Return the findings to the user. If the user requests a final file, create and reopen it under /workspace. Otherwise return findings in chat."
      : "Return findings and source references to the parent. Save working evidence only in the working directory. The parent owns the final answer and user files.";
  return {
    ...definition,
    body: `${definition.body}\n\n${ports.library.system("specialist")}\n\nWorking directory: ${workDirectory}\n${ownership}`,
  };
}

function completeChild(ports: SubagentPorts, child: AgentRunSummary, result: AgentRunResult): void {
  ports.database.transaction(() => {
    ports.store.transitionRun(child.id, {
      state: "succeeded",
      response: result.response,
      performance: runPerformance(result, child.createdAt),
    });
    ports.jobs.transition(child.jobId, "succeeded");
    commandEvent(ports, child, "subagent.completed", "Specialist completed.");
  })();
}

export async function runSubagent(
  ports: SubagentPorts,
  request: SubagentRequest,
): Promise<AgentRunResult> {
  const definition = ports.library.agent(request.subagentType);
  const child = createChild(ports, request);
  try {
    const result = await new ChatAgentLoop(ports.inference).run({
      agent: childDefinition(ports, definition, child.id),
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
      ...(ports.modelNeedsLoad === undefined ? {} : { modelNeedsLoad: ports.modelNeedsLoad }),
      attachments: ports.store.listAttachments(ports.sessionId).map((item, index) => ({
        path: `/run/attachments/${guestAttachmentName(index, item.name)}`,
        displayName: item.name,
        mediaType: item.mediaType,
      })),
      onEvent: (type, summary, detail) => ports.store.appendEvent(child.id, type, summary, detail),
      onResponse: (response) => {
        ports.store.setLiveResponse(child.id, response);
        ports.onResponse?.(response);
      },
      onContext: (used, allocated, measured) => {
        ports.store.setContext(child.id, used, allocated);
        ports.onContext?.(used, allocated, measured);
      },
      signal: ports.signal,
      inferencePriority: "secondary",
      ...(definition.tools.includes("image") ? { inspectImage: ports.inspectImage } : {}),
      skills: {
        metadata: () => [...ports.library.skills],
        read: (name) => ports.library.skill(name).body,
      },
      systemPrompt: (name) => ports.library.system(name),
      task: `${request.description}\n\n${request.prompt}`,
      trace: { runId: child.id, store: ports.store.trace },
    });
    completeChild(ports, child, result);
    return result;
  } catch (error) {
    failChild(ports, child, error);
    throw error;
  }
}

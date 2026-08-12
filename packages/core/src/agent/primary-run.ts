import type { AgentRunResult, AgentRunSummary, ConversationMessage } from "@vault/shared";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import { ChatAgentLoop } from "./chat-loop.js";
import { AGENT_MODEL_ID } from "./limits.js";
import type { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { createRunExecutor } from "./service-executor.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";
import { runSubagent } from "./subagent-run.js";

interface PrimaryRunInput {
  contextTokens: number | "auto";
  database: DatabasePort;
  definitions: MarkdownDefinitionLibrary;
  history: { messages: ConversationMessage[]; summary?: string };
  jobs: JobStore;
  run: AgentRunSummary;
  sessions: AgentSessionManager;
  signal: AbortSignal;
  store: AgentStore;
  task: string;
  chat: InferenceService["chat"];
  onThinking(thinking: string | null): void;
}

export async function runPrimaryAgent(input: PrimaryRunInput): Promise<AgentRunResult> {
  const { definitions, run, store } = input;
  return await new ChatAgentLoop({ chat: input.chat }).run({
    agent: definitions.agent("primary"),
    contextTokens: input.contextTokens,
    executor: createRunExecutor({
      runId: run.id,
      sessionId: run.sessionId,
      store,
      sessions: input.sessions,
    }),
    history: input.history,
    inputNames: store.listAttachments(run.sessionId).map((item) => item.name),
    modelId: AGENT_MODEL_ID,
    onEvent: (type, summary, detail) => store.appendEvent(run.id, type, summary, detail),
    onThinking: input.onThinking,
    savedScripts: store.execution
      .listSessionScriptPaths(run.sessionId)
      .map((path) => `/workspace/${path}`),
    signal: input.signal,
    skills: {
      metadata: () => [...definitions.skills],
      read: (name) => definitions.skill(name).body,
    },
    spawnTask: async (request) => {
      return await runSubagent(
        {
          contextTokens: input.contextTokens,
          database: input.database,
          inference: { chat: input.chat },
          jobs: input.jobs,
          library: definitions,
          modelId: AGENT_MODEL_ID,
          parentRunId: run.id,
          sessionId: run.sessionId,
          sessions: input.sessions,
          signal: input.signal,
          store,
        },
        request,
      );
    },
    systemPrompt: (name) => definitions.system(name),
    task: input.task,
    trace: { runId: run.id, store: store.trace },
  });
}

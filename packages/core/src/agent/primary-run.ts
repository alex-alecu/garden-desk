import type {
  AgentQuestion,
  AgentRunResult,
  AgentRunSummary,
  ConversationMessage,
} from "@vault/shared";
import type { JobStore } from "../jobs/jobs.js";
import type { InferenceService } from "../runtime/inference.js";
import type { DatabasePort } from "../workspace/database.js";
import { ChatAgentLoop } from "./chat-loop.js";
import type { AgentQuestionOutcome } from "./generic-tool-support.js";
import { guestAttachmentName } from "./inputs.js";
import { AGENT_MODEL_ID } from "./limits.js";
import type { MarkdownDefinitionLibrary } from "./markdown-definition-library.js";
import { createRunExecutor } from "./service-executor.js";
import type { AgentSessionManager } from "./session-manager.js";
import type { AgentStore } from "./store.js";
import { runSubagent } from "./subagent-run.js";

interface PrimaryRunInput {
  contextTokens: number | "auto";
  knownContextTokens?: number;
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
  inspectImage(path: string, prompt: string): Promise<string>;
  onThinking(thinking: string | null): void;
  onResponse(response: string | null): void;
  onContext(used: number, allocated: number, measured?: boolean): void;
  askQuestion(questions: AgentQuestion[]): Promise<AgentQuestionOutcome>;
}

export async function runPrimaryAgent(input: PrimaryRunInput): Promise<AgentRunResult> {
  const { definitions, run, store } = input;
  const attachments = store.listAttachments(run.sessionId).map((item, index) => ({
    path: `/run/attachments/${guestAttachmentName(index, item.name)}`,
    displayName: item.name,
    mediaType: item.mediaType,
  }));
  return await new ChatAgentLoop({ chat: input.chat }).run({
    agent: definitions.agent("primary"),
    contextTokens: input.contextTokens,
    ...(input.knownContextTokens === undefined
      ? {}
      : { knownContextTokens: input.knownContextTokens }),
    executor: createRunExecutor({
      runId: run.id,
      sessionId: run.sessionId,
      store,
      sessions: input.sessions,
    }),
    history: input.history,
    inspectImage: input.inspectImage,
    attachments,
    modelId: AGENT_MODEL_ID,
    onEvent: (type, summary, detail) => store.appendEvent(run.id, type, summary, detail),
    onThinking: input.onThinking,
    onResponse: input.onResponse,
    onContext: input.onContext,
    askQuestion: input.askQuestion,
    savedScripts: store.execution
      .listSessionScriptPaths(run.sessionId)
      .map((path) => `/workspace/${path}`),
    signal: input.signal,
    skills: {
      metadata: () => [...definitions.skills],
      read: (name) => definitions.skill(name).body,
    },
    spawnTask: (request) => runPrimarySubagent(input, request),
    systemPrompt: (name) => definitions.system(name),
    task: input.task,
    trace: { runId: run.id, store: store.trace },
  });
}

async function runPrimarySubagent(
  input: PrimaryRunInput,
  request: Parameters<typeof runSubagent>[1],
): Promise<string> {
  return await runSubagent(
    {
      contextTokens: input.contextTokens,
      ...(input.knownContextTokens === undefined
        ? {}
        : { knownContextTokens: input.knownContextTokens }),
      database: input.database,
      inference: { chat: input.chat },
      inspectImage: input.inspectImage,
      jobs: input.jobs,
      library: input.definitions,
      modelId: AGENT_MODEL_ID,
      parentRunId: input.run.id,
      sessionId: input.run.sessionId,
      sessions: input.sessions,
      signal: input.signal,
      store: input.store,
    },
    request,
  );
}

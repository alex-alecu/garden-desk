import type { AgentEventDetail, AgentEventType, AgentQuestion } from "@vault/shared";
import type { AgentExecutor } from "./agent-executor.js";
import type { AgentQuestionOutcome, SkillReader, SubagentRequest } from "./generic-tools.js";
import type { AgentDefinition } from "./markdown-definition-library.js";
import type { AgentTraceStore } from "./trace-store.js";

type ConversationItem = { role: "user" | "assistant"; content: string };
export interface ChatAttachmentInput {
  path: string;
  displayName: string;
  mediaType: string;
}

export type ChatRecoveryState = {
  emptyResponsePending: boolean;
  inferenceRetryUsed: boolean;
  outputLimitRetryUsed: boolean;
};

export interface ChatAgentInput {
  agent: AgentDefinition;
  contextTokens: number | "auto";
  knownContextTokens?: number;
  executor: AgentExecutor;
  history?: { messages: ConversationItem[]; summary?: string };
  attachments?: ChatAttachmentInput[];
  modelId: string;
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  onThinking?(text: string | null): void;
  onResponse?(text: string | null): void;
  onContext?(used: number, allocated: number, measured?: boolean): void;
  savedScripts?: string[];
  signal?: AbortSignal;
  skills: SkillReader;
  inferencePriority?: "primary" | "secondary";
  inspectImage?(path: string, prompt: string): Promise<string>;
  spawnTask?(request: SubagentRequest): Promise<string>;
  askQuestion?(questions: AgentQuestion[]): Promise<AgentQuestionOutcome>;
  systemPrompt(name: string): string;
  task: string;
  trace?: { runId: string; store: AgentTraceStore };
}

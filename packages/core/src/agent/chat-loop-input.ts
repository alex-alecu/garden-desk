import type {
  AgentEventDetail,
  AgentEventType,
  AgentQuestion,
  AgentRunResult,
} from "@gardendesk/shared";
import type { AgentExecutor } from "./agent-executor.js";
import type { ChatToolState } from "./chat-tool-turn.js";
import type {
  AgentQuestionOutcome,
  GenericToolRegistry,
  SkillReader,
  SubagentRequest,
} from "./generic-tools.js";
import type { emptyPerformance } from "./inference-performance.js";
import type { AgentDefinition } from "./markdown-definition-library.js";
import type { AgentTraceStore } from "./trace-store.js";

type ConversationItem = { role: "user" | "assistant"; content: string };
export interface ChatAttachmentInput {
  path: string;
  displayName: string;
  mediaType: string;
}

export type ChatRecoveryState = {
  inferenceRetryUsed: boolean;
};

export interface ChatTurnOptions {
  input: ChatAgentInput;
  state: ChatToolState;
  registry: GenericToolRegistry;
  recovery: ChatRecoveryState;
  performance: ReturnType<typeof emptyPerformance>;
}

export interface ChatAgentInput {
  agent: AgentDefinition;
  contextTokens: number | "auto";
  knownContextTokens?: number;
  executor: AgentExecutor;
  history?: { messages: ConversationItem[]; summary?: string };
  attachments?: ChatAttachmentInput[];
  modelId: string;
  modelNeedsLoad?: boolean;
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  onThinking?(text: string | null): void;
  onResponse?(text: string | null): void;
  onContext?(used: number, allocated: number, measured?: boolean): void;
  signal?: AbortSignal;
  skills: SkillReader;
  inferencePriority?: "primary" | "secondary";
  inspectImage?(path: string, prompt: string): Promise<string>;
  spawnTask?(request: SubagentRequest): Promise<Pick<AgentRunResult, "response" | "executions">>;
  askQuestion?(questions: AgentQuestion[]): Promise<AgentQuestionOutcome>;
  systemPrompt(name: string): string;
  task: string;
  trace?: { runId: string; store: AgentTraceStore };
}

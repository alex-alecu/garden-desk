import type { AgentEventDetail, AgentEventType, AgentQuestion } from "@vault/shared";
import type { AgentExecutor } from "./agent-executor.js";
import type { AgentQuestionOutcome, SkillReader, SubagentRequest } from "./generic-tools.js";
import type { AgentDefinition } from "./markdown-definition-library.js";
import type { AgentTraceStore } from "./trace-store.js";

type ConversationItem = { role: "user" | "assistant"; content: string };

export interface ChatAgentInput {
  agent: AgentDefinition;
  contextTokens: number | "auto";
  executor: AgentExecutor;
  history?: { messages: ConversationItem[]; summary?: string };
  inputNames?: string[];
  modelId: string;
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  onThinking?(text: string | null): void;
  onContext?(used: number, allocated: number): void;
  savedScripts?: string[];
  signal?: AbortSignal;
  skills: SkillReader;
  inferencePriority?: "primary" | "secondary";
  spawnTask?(request: SubagentRequest): Promise<string>;
  askQuestion?(questions: AgentQuestion[]): Promise<AgentQuestionOutcome>;
  systemPrompt(name: string): string;
  task: string;
  trace?: { runId: string; store: AgentTraceStore };
}

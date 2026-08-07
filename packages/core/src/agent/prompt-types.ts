import type { AgentExecutionResult, InferencePerformance } from "@vault/shared";
import type { DurableAgentHistory } from "./history.js";
import type { RejectedExecutionReason } from "./loop-decisions.js";
import type { PromptLibrary } from "./prompt-library.js";

export interface AgentPromptInput {
  task: string;
  modelId: string;
  inputNames?: string[];
  history?: DurableAgentHistory;
  continuation?: boolean;
  promptLibrary?: PromptLibrary;
}

export interface AgentProgress {
  executions: AgentExecutionResult[];
  inference: InferencePerformance;
  lastRejectedProgramReason?: RejectedExecutionReason | undefined;
  rejectedDuplicates: number;
  requestedSkills?: Set<string>;
  sourceExecutionRequired?: boolean;
  deliverableExecutionRequired?: boolean;
  skillsActivated?: boolean;
}

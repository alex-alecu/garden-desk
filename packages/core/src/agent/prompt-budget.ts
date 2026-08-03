import { type AgentExecutionResult, MAX_GENERATION_TOKENS } from "@vault/shared";
import { assembleHistory, type DurableAgentHistory } from "./history.js";
import { requiredOutputLabels, xlsxWorkflowPhase } from "./output-contract.js";
import type { AgentProgress, AgentPromptInput, GenerationRecovery } from "./prompt.js";
import type { PromptLibrary } from "./prompt-library.js";
import { GENERATION_LIMIT_RECOVERY_SOURCE_LINES } from "./prompt-schema.js";
import { requiresXlsxWorkflow, xlsxProcessingExecutions } from "./prompt-xlsx.js";

const MINIMUM_GENERATION_RESERVE_TOKENS = 4_096;
const GENERATION_LIMIT_RECOVERY_TOKENS = 8_192;

export interface PromptBounds {
  contextTokens: number;
  generationTokens: number;
  requestOverheadTokens: number;
}

export function usablePromptTokens(bounds: PromptBounds): number {
  return Math.max(0, bounds.contextTokens - bounds.generationTokens - bounds.requestOverheadTokens);
}

export function serializePrompt(
  current: string,
  history: DurableAgentHistory | undefined,
  bounds: PromptBounds,
): string {
  const usableTokens = usablePromptTokens(bounds);
  const requiredTokens = Math.ceil(current.length / 4);
  if (requiredTokens > usableTokens) throw new Error("agent_context_exhausted");
  const assembled = assembleHistory(history, usableTokens - requiredTokens);
  const serialized = assembled.length === 0 ? current : `${current}\n${assembled}`;
  if (Math.ceil(serialized.length / 4) > usableTokens) throw new Error("agent_context_exhausted");
  return serialized;
}

export function generationTokenReserve(contextTokens: number, maxTokens: number): number {
  return Math.min(maxTokens, Math.max(MINIMUM_GENERATION_RESERVE_TOKENS, contextTokens - 4_096));
}

function failedLatestExecution(executions: AgentExecutionResult[]): boolean {
  const latest = executions.at(-1);
  return (
    latest !== undefined &&
    (latest.exitCode !== 0 || latest.termination !== "completed" || latest.stderr.trim().length > 0)
  );
}

export function generationBudget(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  recovery: GenerationRecovery,
): number {
  if (finalResponse) return MINIMUM_GENERATION_RESERVE_TOKENS;
  const xlsxPhase = requiresXlsxWorkflow(input, progress.executions)
    ? xlsxWorkflowPhase(
        xlsxProcessingExecutions(progress.executions),
        requiredOutputLabels(input.task),
      )
    : undefined;
  if (
    recovery === "generation_limit" ||
    progress.lastRejectedProgramReason !== undefined ||
    failedLatestExecution(progress.executions) ||
    xlsxPhase === "repair" ||
    xlsxPhase === "continue"
  )
    return GENERATION_LIMIT_RECOVERY_TOKENS;
  return MAX_GENERATION_TOKENS;
}

export function generationRecoveryInstructions(
  recovery: GenerationRecovery,
  finalResponse: boolean,
  library: PromptLibrary,
): readonly string[] {
  if (recovery !== "generation_limit") return [];
  if (finalResponse) {
    return [
      library.recovery("generation-limit-final", {
        max_generation_tokens: MAX_GENERATION_TOKENS.toLocaleString("en-US"),
      }),
    ];
  }
  return [
    library.recovery("generation-limit", {
      max_generation_tokens: MAX_GENERATION_TOKENS.toLocaleString("en-US"),
      recovery_tokens: GENERATION_LIMIT_RECOVERY_TOKENS.toLocaleString("en-US"),
      source_line_limit: GENERATION_LIMIT_RECOVERY_SOURCE_LINES,
    }),
  ];
}

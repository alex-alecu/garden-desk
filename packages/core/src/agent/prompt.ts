import {
  type AgentDecision,
  AgentDecisionSchema,
  type AgentExecutionResult,
  type InferencePerformance,
} from "@vault/shared";
import { effectiveGenerationInput, type GenerationInput } from "../runtime/inference.js";
import { artifactCandidateNames } from "./artifact-declarations.js";
import type { DurableAgentHistory } from "./history.js";
import { MAX_AGENT_EXECUTIONS } from "./limits.js";
import type { RejectedExecutionReason } from "./loop-decisions.js";
import {
  completedSuccessfully,
  missingOutputLabels,
  requiredOutputLabels,
  verifiedXlsxOutput,
  xlsxWorkflowPhase,
} from "./output-contract.js";
import {
  generationBudget,
  generationRecoveryInstructions,
  generationTokenReserve,
  type PromptBounds,
  serializePrompt,
  usablePromptTokens,
} from "./prompt-budget.js";
import { activePromptSkillNames, systemPrompt, taskStatePrompt } from "./prompt-content.js";
import { attachedPdfAlreadyExtracted, continuationInstructions } from "./prompt-inputs.js";
import { defaultPromptLibrary, type PromptLibrary } from "./prompt-library.js";
import { observationStreamCharacters } from "./prompt-observations.js";
import { rejectionInstructions } from "./prompt-rejection.js";
import {
  agentDecisionJsonSchema,
  GENERATION_LIMIT_RECOVERY_SOURCE_LINES,
} from "./prompt-schema.js";
import {
  requiresXlsxWorkflow,
  xlsxPhaseInstructions,
  xlsxProcessingExecutions,
} from "./prompt-xlsx.js";

export { requiresXlsxWorkflow } from "./prompt-xlsx.js";

export const MAX_EXECUTIONS = MAX_AGENT_EXECUTIONS;

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
}

function needsShellSourceRepair(progress: AgentProgress): boolean {
  if (
    progress.lastRejectedProgramReason === "shell_limit" ||
    progress.lastRejectedProgramReason === "shell_source"
  )
    return true;
  const latest = progress.executions.at(-1);
  return (
    latest?.language === "shell" &&
    latest.exitCode !== 0 &&
    /unterminated quoted string/iu.test(latest.stderr)
  );
}

function needsSourceDiscoveryRepair(
  input: AgentPromptInput,
  progress: AgentProgress,
  library: PromptLibrary,
): boolean {
  if (!activePromptSkillNames(input, progress, library).has("terminal-commands")) return false;
  const latest = progress.executions.at(-1);
  return (
    latest?.language === "shell" &&
    (latest.exitCode !== 0 ||
      latest.termination !== "completed" ||
      latest.stderr.trim().length > 0 ||
      latest.stdout.trim().length === 0)
  );
}

function shellSourceRepairInstructions(
  progress: AgentProgress,
  library: PromptLibrary,
): readonly string[] {
  const latest = progress.executions.at(-1);
  if (
    latest?.language !== "shell" ||
    latest.exitCode === 0 ||
    !/unterminated quoted string/iu.test(latest.stderr)
  )
    return [];
  return [library.recovery("shell-quote")];
}

export type GenerationRecovery = "generation_limit" | undefined;
interface PromptOptions extends PromptBounds {
  recovery: GenerationRecovery;
}
interface GenerationInputOptions {
  contextTokens?: number;
  recovery?: GenerationRecovery;
}

function joinedPromptSections(sections: readonly string[]): string {
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function prompt(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  options: PromptOptions,
): string {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const { executions } = progress;
  const hasXlsxInput = requiresXlsxWorkflow(input, progress.executions);
  const requiredLabels = requiredOutputLabels(input.task);
  const completed = executions.filter(completedSuccessfully);
  const missingLabels = missingOutputLabels(completed.at(-1)?.stdout ?? "", requiredLabels);
  const beforeTask = [
    systemPrompt(input, progress, library),
    ...generationRecoveryInstructions(options.recovery, finalResponse, library),
    ...continuationInstructions(input.continuation, library),
  ];
  const afterTask = [
    ...rejectionInstructions(progress, library),
    ...shellSourceRepairInstructions(progress, library),
    ...xlsxPhaseInstructions({
      finalResponse,
      hasXlsxInput,
      executions,
      library,
      requiredLabels,
      missingLabels,
      task: input.task,
    }),
  ];
  const fixed = joinedPromptSections([
    ...beforeTask,
    taskStatePrompt(input, progress, library, 0),
    ...afterTask,
  ]);
  const remainingCharacters = Math.max(0, usablePromptTokens(options) * 4 - fixed.length);
  const observationCharacters = Math.min(
    remainingCharacters,
    observationStreamCharacters(Math.floor(remainingCharacters / 4)),
  );
  const current = joinedPromptSections([
    ...beforeTask,
    taskStatePrompt(input, progress, library, observationCharacters),
    ...afterTask,
  ]);
  return serializePrompt(current, input.history, options);
}

function recoverySourceLineLimit(
  generationLimitRecovery: boolean,
  sourceDiscoveryRecovery: boolean,
): { sourceLineLimit?: number } {
  if (generationLimitRecovery) return { sourceLineLimit: GENERATION_LIMIT_RECOVERY_SOURCE_LINES };
  if (sourceDiscoveryRecovery) return { sourceLineLimit: 40 };
  return {};
}

function generationSchema(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  recovery: GenerationRecovery,
) {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const requiredLabels = requiredOutputLabels(input.task);
  const requiresXlsxExecution =
    !finalResponse &&
    requiresXlsxWorkflow(input, progress.executions) &&
    xlsxWorkflowPhase(xlsxProcessingExecutions(progress.executions), requiredLabels) !== "complete";
  const inputNames = input.inputNames ?? [];
  const requiresAttachedPdfExecution =
    !finalResponse &&
    progress.executions.length === 0 &&
    inputNames.some((name) => name.toLocaleLowerCase("en-US").endsWith(".pdf")) &&
    !attachedPdfAlreadyExtracted(inputNames, input.history);
  const generationLimitRecovery = recovery === "generation_limit" && !finalResponse;
  const sourceDiscoveryRecovery =
    progress.lastRejectedProgramReason === "source_allowlist" && !finalResponse;
  const artifactNames = artifactCandidateNames(progress.executions);
  return agentDecisionJsonSchema({
    artifactNames,
    task: input.task,
    finalResponse,
    requiresSourceExecution:
      requiresXlsxExecution ||
      requiresAttachedPdfExecution ||
      needsShellSourceRepair(progress) ||
      needsSourceDiscoveryRepair(input, progress, library) ||
      generationLimitRecovery,
    ...recoverySourceLineLimit(generationLimitRecovery, sourceDiscoveryRecovery),
    ...(requiresAttachedPdfExecution ? { requiredLanguage: "python" as const } : {}),
  });
}

interface BuildGenerationInput {
  input: AgentPromptInput;
  progress: AgentProgress;
  finalResponse: boolean;
  options: PromptOptions;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

function buildGenerationInput(build: BuildGenerationInput): GenerationInput {
  return effectiveGenerationInput({
    modelId: build.input.modelId,
    prompt: prompt(build.input, build.progress, build.finalResponse, build.options),
    jsonSchema: build.jsonSchema,
    contextSize: "auto",
    maxTokens: build.maxTokens,
  });
}

export function generationInput(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse = false,
  options: GenerationInputOptions = {},
): GenerationInput {
  const contextTokens = options.contextTokens ?? 8_192;
  const recovery = options.recovery;
  const jsonSchema = generationSchema(input, progress, finalResponse, recovery);
  const maxTokens = generationBudget(input, progress, finalResponse, recovery);
  const generationTokens = generationTokenReserve(contextTokens, maxTokens);
  let requestOverheadTokens = Math.ceil(
    JSON.stringify({
      modelId: input.modelId,
      jsonSchema,
      contextSize: "auto",
      maxTokens,
    }).length / 4,
  );
  const build = (overhead: number) =>
    buildGenerationInput({
      input,
      progress,
      finalResponse,
      options: { contextTokens, generationTokens, requestOverheadTokens: overhead, recovery },
      jsonSchema,
      maxTokens,
    });
  const result = build(requestOverheadTokens);
  const requestBudget = Math.max(0, contextTokens - generationTokens);
  const requestTokens = Math.ceil(JSON.stringify(result).length / 4);
  if (requestTokens > requestBudget) {
    requestOverheadTokens += requestTokens - requestBudget;
    result.prompt = build(requestOverheadTokens).prompt;
  }
  if (Math.ceil(JSON.stringify(result).length / 4) > requestBudget) {
    throw new Error("agent_context_exhausted");
  }
  return result;
}

export function parseDecision(value: unknown): AgentDecision {
  if (typeof value !== "object" || value === null) return AgentDecisionSchema.parse(value);
  const decision = value as Record<string, unknown>;
  if (decision.action === "execute" && Array.isArray(decision.source)) {
    return AgentDecisionSchema.parse({ ...decision, source: decision.source.join("\n") });
  }
  if (decision.action === "execute" && Array.isArray(decision.command)) {
    return AgentDecisionSchema.parse({ ...decision, command: decision.command.join("\n") });
  }
  if (decision.action === "respond" && Array.isArray(decision.response)) {
    return AgentDecisionSchema.parse({ ...decision, response: decision.response.join("\n") });
  }
  return AgentDecisionSchema.parse(value);
}

export function executionBackedResponse(
  input: AgentPromptInput,
  progress: AgentProgress,
  fallback: string,
): string {
  if (!requiresXlsxWorkflow(input, progress.executions)) return fallback;
  const requiredLabels = requiredOutputLabels(input.task);
  return verifiedXlsxOutput(progress.executions, requiredLabels) ?? fallback;
}

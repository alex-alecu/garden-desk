import type { AgentDecision } from "@vault/shared";
import { effectiveGenerationInput, type GenerationInput } from "../runtime/inference.js";
import { MAX_AGENT_EXECUTIONS } from "./limits.js";
import {
  completedSuccessfully,
  missingOutputLabels,
  requiredOutputLabels,
} from "./output-contract.js";
import {
  generationBudget,
  generationRecoveryInstructions,
  generationTokenReserve,
  type PromptBounds,
  serializePrompt,
  usablePromptTokens,
} from "./prompt-budget.js";
import { systemPrompt, taskStatePrompt } from "./prompt-content.js";
import { fitCurrentPrompt, joinedPromptSections } from "./prompt-fitting.js";
import {
  type GenerationRecovery,
  generationSchema,
  needsSourceDiscoveryRepair,
} from "./prompt-generation-schema.js";
import { continuationInstructions } from "./prompt-inputs.js";
import { defaultPromptLibrary, type PromptLibrary } from "./prompt-library.js";
import { parseAgentDecision } from "./prompt-normalization.js";
import { observationStreamCharacters } from "./prompt-observations.js";
import {
  progressEnabled,
  progressExecutionBackedResponse,
  progressInstructions,
} from "./prompt-progress.js";
import { rejectionInstructions } from "./prompt-rejection.js";
import type { AgentProgress, AgentPromptInput } from "./prompt-types.js";

export const MAX_EXECUTIONS = MAX_AGENT_EXECUTIONS;

export type { GenerationRecovery } from "./prompt-generation-schema.js";
export type { AgentProgress, AgentPromptInput } from "./prompt-types.js";

function sourceDiscoveryRepairInstructions(
  input: AgentPromptInput,
  progress: AgentProgress,
  library: PromptLibrary,
): readonly string[] {
  if (!needsSourceDiscoveryRepair(input, progress, library)) return [];
  return [library.recovery("source-empty")];
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

interface PromptOptions extends PromptBounds {
  recovery: GenerationRecovery;
}
interface GenerationInputOptions {
  contextTokens?: number;
  recovery?: GenerationRecovery;
}

function prompt(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  options: PromptOptions,
): string {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const requiredLabels = requiredOutputLabels(input.task);
  const completed = progress.executions.filter(completedSuccessfully).at(-1);
  const missingLabels = missingOutputLabels(completed?.stdout ?? "", requiredLabels);
  const beforeTask = [
    systemPrompt(input, progress, library),
    ...generationRecoveryInstructions(options.recovery, finalResponse, library),
    ...continuationInstructions(input.continuation, library),
  ];
  const afterTask = [
    ...rejectionInstructions(progress, library),
    ...shellSourceRepairInstructions(progress, library),
    ...sourceDiscoveryRepairInstructions(input, progress, library),
    ...progressInstructions({
      finalResponse,
      input,
      progress,
      library,
      requiredLabels,
      missingLabels,
    }),
  ];
  const fixedState = taskStatePrompt(input, progress, library, {
    observationCharacters: 0,
    includeCompaction: false,
  });
  const fixed = joinedPromptSections([...beforeTask, fixedState, ...afterTask]);
  const maximumCharacters = usablePromptTokens(options) * 4;
  const remainingCharacters = Math.max(0, maximumCharacters - fixed.length);
  const observationCharacters = Math.min(
    remainingCharacters,
    observationStreamCharacters(Math.floor(remainingCharacters / 4)),
  );
  const current = fitCurrentPrompt(
    {
      beforeTask,
      afterTask,
      observationCharacters,
      taskState: (characters) =>
        taskStatePrompt(input, progress, library, { observationCharacters: characters }),
    },
    maximumCharacters,
  );
  return serializePrompt(current, input.history, options);
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
  if (Math.ceil(JSON.stringify(result).length / 4) > requestBudget)
    throw new Error("agent_context_exhausted");
  return result;
}

export function parseDecision(value: unknown): AgentDecision {
  return parseAgentDecision(value);
}

export function executionBackedResponse(
  input: AgentPromptInput,
  progress: AgentProgress,
  fallback: string,
): string {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  if (!progressEnabled(input, progress, library)) return fallback;
  const requiredLabels = requiredOutputLabels(input.task);
  return progressExecutionBackedResponse(input, progress.executions, requiredLabels) ?? fallback;
}

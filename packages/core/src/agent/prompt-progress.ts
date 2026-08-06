import { type AgentExecutionResult, parseWorkProgress, stripWorkProgress } from "@vault/shared";
import { executionSucceeded } from "./history.js";
import {
  completedSuccessfully,
  latestGfmTableOutput,
  type ProgressWorkflowPhase,
  progressWorkflowPhase,
  validGfmTable,
  verifiedProgressOutput,
} from "./output-contract.js";
import type { AgentProgress, AgentPromptInput } from "./prompt.js";
import { activePromptSkillNames } from "./prompt-content.js";
import type { PromptLibrary } from "./prompt-library.js";

export function progressExecutions(executions: AgentExecutionResult[]): AgentExecutionResult[] {
  return executions.filter((execution) => execution.language !== "shell");
}

function latestHistoricalOutput(input: AgentPromptInput): string | undefined {
  const latest = input.history?.runs
    .flatMap((run) => run.events)
    .filter(
      (event) =>
        event.type === "execution.completed" &&
        executionSucceeded(event) &&
        parseWorkProgress(event.stdout ?? "") !== undefined,
    )
    .at(-1);
  return latest?.stdout ?? undefined;
}

function requestsTable(task: string): boolean {
  return /\b(?:table|tabel(?:ul)?)\b/iu.test(task);
}

function hasCompleteHistoricalProgress(input: AgentPromptInput): boolean {
  const stdout = latestHistoricalOutput(input);
  return stdout !== undefined && parseWorkProgress(stdout)?.complete === true;
}

function historicalResultSatisfies(input: AgentPromptInput): boolean {
  const stdout = latestHistoricalOutput(input);
  if (stdout === undefined || parseWorkProgress(stdout)?.complete !== true) return false;
  const result = stripWorkProgress(stdout);
  return requestsTable(input.task) ? validGfmTable(result) : result.length > 0;
}

export function progressEnabled(
  input: AgentPromptInput,
  progress: AgentProgress,
  library: PromptLibrary,
): boolean {
  return library.progressSkill(activePromptSkillNames(input, progress, library)) !== undefined;
}

export function progressExecutionBackedResponse(
  input: AgentPromptInput,
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): string | undefined {
  const verified = verifiedProgressOutput(executions, requiredLabels);
  if (!requestsTable(input.task)) return verified;
  const table = latestGfmTableOutput(executions);
  return table !== undefined && (verified !== undefined || hasCompleteHistoricalProgress(input))
    ? table
    : undefined;
}

interface ProgressExecutionInput {
  finalResponse: boolean;
  input: AgentPromptInput;
  library: PromptLibrary;
  progress: AgentProgress;
  requiredLabels: string[];
}

export function needsProgressExecution(options: ProgressExecutionInput): boolean {
  const { finalResponse, input, library, progress, requiredLabels } = options;
  if (finalResponse || !progressEnabled(input, progress, library)) return false;
  if (progress.executions.length === 0 && historicalResultSatisfies(input)) return false;
  if (progressWorkflowPhase(progressExecutions(progress.executions), requiredLabels) !== "complete")
    return true;
  return (
    requestsTable(input.task) &&
    progressExecutionBackedResponse(input, progress.executions, requiredLabels) === undefined
  );
}

interface PhaseInstructionInput {
  finalResponse: boolean;
  hasCleanUnmarkedOutput: boolean;
  hasCleanLabeledOutput: boolean;
  phase: ProgressWorkflowPhase;
  skillName: string | undefined;
  library: PromptLibrary;
}

function phaseInstructions(input: PhaseInstructionInput): readonly string[] {
  if (input.finalResponse) return [input.library.state("final-response")];
  if (input.skillName === undefined) return [];
  const state = (name: string) => input.library.skillState(input.skillName as string, name);
  if (input.phase === "work") return [state("progress-work")];
  if (input.phase === "repair") {
    if (input.hasCleanLabeledOutput) return [state("progress-missing-coverage")];
    if (input.hasCleanUnmarkedOutput) return [state("progress-missing-markers")];
    return [state("progress-repair")];
  }
  return input.phase === "continue" ? [state("progress-continue")] : [];
}

function hasCleanLabeledOutput(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
  missingLabels: string[],
): boolean {
  const last = executions.at(-1);
  return (
    last !== undefined &&
    completedSuccessfully(last) &&
    last.stderr.trim().length === 0 &&
    requiredLabels.length > 0 &&
    missingLabels.length === 0
  );
}

function hasCleanUnmarkedOutput(
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): boolean {
  const last = executions.at(-1);
  return (
    last !== undefined &&
    completedSuccessfully(last) &&
    last.stderr.trim().length === 0 &&
    requiredLabels.length > 0 &&
    parseWorkProgress(last.stdout) === undefined
  );
}

interface ProgressInstructionsInput {
  finalResponse: boolean;
  input: AgentPromptInput;
  progress: AgentProgress;
  library: PromptLibrary;
  requiredLabels: string[];
  missingLabels: string[];
}

export function progressInstructions(input: ProgressInstructionsInput): readonly string[] {
  const activeNames = activePromptSkillNames(input.input, input.progress, input.library);
  const skill = input.library.progressSkill(activeNames);
  if (skill === undefined)
    return input.finalResponse ? [input.library.state("final-response")] : [];
  const executions = progressExecutions(input.progress.executions);
  const instructions = phaseInstructions({
    finalResponse: input.finalResponse,
    hasCleanUnmarkedOutput: hasCleanUnmarkedOutput(executions, input.requiredLabels),
    hasCleanLabeledOutput: hasCleanLabeledOutput(
      executions,
      input.requiredLabels,
      input.missingLabels,
    ),
    phase: progressWorkflowPhase(executions, input.requiredLabels),
    skillName: skill.name,
    library: input.library,
  });
  const latest = executions.at(-1);
  if (latest === undefined) return instructions;
  const repairs = input.library.repairPrompts(activeNames, `${latest.stderr}\n${latest.stdout}`);
  const invalidTable =
    requestsTable(input.input.task) &&
    completedSuccessfully(latest) &&
    !validGfmTable(stripWorkProgress(latest.stdout));
  return invalidTable
    ? [...instructions, input.library.skillRecovery(skill.name, "table")]
    : [...instructions, ...repairs];
}

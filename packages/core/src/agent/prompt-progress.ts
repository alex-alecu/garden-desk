import { type AgentExecutionResult, parseWorkProgress, stripWorkProgress } from "@vault/shared";
import {
  artifactCandidateNames,
  requestedArtifactNames,
  requestedFactLabels,
} from "./artifact-declarations.js";
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
import { workflowShapePrompts } from "./prompt-workflow-shapes.js";

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
  return (
    library.progressSkill(activePromptSkillNames(input, progress, library), input.task) !==
    undefined
  );
}

export function progressExecutionBackedResponse(
  input: AgentPromptInput,
  executions: AgentExecutionResult[],
  requiredLabels: string[],
): string | undefined {
  const verified = verifiedProgressOutput(executions, requiredLabels);
  if (!requestsTable(input.task)) return verified;
  if (
    verified !== undefined &&
    artifactCandidateNames(executions, requestedFactLabels(input.task)).length > 0
  )
    return verified;
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
  const phase = progressWorkflowPhase(progressExecutions(progress.executions), requiredLabels);
  if (phase !== "complete") return true;
  if (
    requestsTable(input.task) &&
    artifactCandidateNames(progress.executions, requestedFactLabels(input.task)).length > 0
  ) {
    return false;
  }
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

function progressRepairPrompts(
  input: ProgressInstructionsInput,
  activeNames: ReadonlySet<string>,
  phase: ProgressWorkflowPhase,
  latest: AgentExecutionResult,
): readonly string[] {
  return phase === "complete"
    ? []
    : input.library.repairPrompts(activeNames, `${latest.stderr}\n${latest.stdout}`);
}

interface PostExecutionInstructionsInput {
  activeNames: ReadonlySet<string>;
  input: ProgressInstructionsInput;
  latest: AgentExecutionResult;
  phase: ProgressWorkflowPhase;
  skillName: string;
}

function currentWorkflowShapePrompts(
  options: Omit<PostExecutionInstructionsInput, "latest"> & { latest?: AgentExecutionResult },
): readonly string[] {
  const { activeNames, input, latest, phase, skillName } = options;
  return workflowShapePrompts(
    {
      activeNames,
      input: input.input,
      ...(latest === undefined ? {} : { latestStdout: latest.stdout }),
      phase,
      progress: input.progress,
      requiredLabels: input.requiredLabels,
      skillName,
    },
    input.library,
  );
}

function postExecutionInstructions(options: PostExecutionInstructionsInput): readonly string[] {
  const { activeNames, input, latest, phase, skillName } = options;
  const shapes = currentWorkflowShapePrompts(options);
  const repairs = progressRepairPrompts(input, activeNames, phase, latest);
  const candidates = artifactCandidateNames(
    input.progress.executions,
    requestedFactLabels(input.input.task),
  );
  const missingArtifact = requestedArtifactNames(input.input.task).some(
    (name) => !candidates.includes(name),
  );
  const deliverableStates =
    missingArtifact && input.progress.executions.length > 0
      ? input.library.activeSkillStates(activeNames, "deliverable-create")
      : [];
  const invalidTable =
    requestsTable(input.input.task) &&
    candidates.length === 0 &&
    completedSuccessfully(latest) &&
    !validGfmTable(stripWorkProgress(latest.stdout));
  return invalidTable
    ? [...shapes, ...deliverableStates, input.library.skillRecovery(skillName, "table")]
    : [...shapes, ...deliverableStates, ...repairs];
}

export function progressInstructions(input: ProgressInstructionsInput): readonly string[] {
  const activeNames = activePromptSkillNames(input.input, input.progress, input.library);
  const skill = input.library.progressSkill(activeNames, input.input.task);
  if (skill === undefined)
    return input.finalResponse ? [input.library.state("final-response")] : [];
  const executions = progressExecutions(input.progress.executions);
  const phase = progressWorkflowPhase(executions, input.requiredLabels);
  const instructions = phaseInstructions({
    finalResponse: input.finalResponse,
    hasCleanUnmarkedOutput: hasCleanUnmarkedOutput(executions, input.requiredLabels),
    hasCleanLabeledOutput: hasCleanLabeledOutput(
      executions,
      input.requiredLabels,
      input.missingLabels,
    ),
    phase,
    skillName: skill.name,
    library: input.library,
  });
  const latest = executions.at(-1);
  if (latest === undefined) {
    return [
      ...instructions,
      ...currentWorkflowShapePrompts({ input, activeNames, skillName: skill.name, phase }),
    ];
  }
  return [
    ...instructions,
    ...postExecutionInstructions({ input, activeNames, skillName: skill.name, phase, latest }),
  ];
}

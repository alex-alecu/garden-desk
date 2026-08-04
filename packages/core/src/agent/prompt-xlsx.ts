import { type AgentExecutionResult, parseXlsxProgress } from "@vault/shared";
import {
  completedSuccessfully,
  type XlsxWorkflowPhase,
  xlsxWorkflowPhase,
} from "./output-contract.js";
import type { AgentPromptInput } from "./prompt.js";
import type { PromptLibrary } from "./prompt-library.js";

function discoveredXlsxForDataTask(
  input: AgentPromptInput,
  executions: AgentExecutionResult[],
): boolean {
  if (!/(?:transaction|tranzac|salari|avans|workbook|spreadsheet)/iu.test(input.task)) return false;
  return executions.some((execution) =>
    [execution.command, execution.source, execution.stdout].some(
      (value) => value !== null && /\.xlsx\b/iu.test(value),
    ),
  );
}

export function requiresXlsxWorkflow(
  input: AgentPromptInput,
  executions: AgentExecutionResult[] = [],
): boolean {
  return (
    (input.inputNames ?? []).some((name) => name.toLowerCase().endsWith(".xlsx")) ||
    /\b(?:excel|xlsx)\b|\.xlsx?\b/iu.test(input.task) ||
    discoveredXlsxForDataTask(input, executions)
  );
}

interface PhaseInstructionInput {
  finalResponse: boolean;
  hasCleanUnmarkedOutput: boolean;
  hasCleanLabeledOutput: boolean;
  hasXlsxInput: boolean;
  library: PromptLibrary;
  xlsxPhase: XlsxWorkflowPhase;
}

function phaseInstructions(input: PhaseInstructionInput): readonly string[] {
  if (input.finalResponse) {
    return [input.library.state("final-response")];
  }
  if (!input.hasXlsxInput) return [];
  if (input.xlsxPhase === "work") return [input.library.state("xlsx-work")];
  if (input.xlsxPhase === "repair") {
    if (input.hasCleanLabeledOutput) {
      return [input.library.state("xlsx-missing-coverage")];
    }
    if (input.hasCleanUnmarkedOutput) {
      return [input.library.state("xlsx-missing-markers")];
    }
    return [input.library.state("xlsx-repair")];
  }
  if (input.xlsxPhase === "continue") return [input.library.state("xlsx-continue")];
  return [];
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
    parseXlsxProgress(last.stdout) === undefined
  );
}

export function xlsxProcessingExecutions(
  executions: AgentExecutionResult[],
): AgentExecutionResult[] {
  return executions.filter((execution) => execution.language !== "shell");
}

interface XlsxPhaseInstructionsInput {
  finalResponse: boolean;
  hasXlsxInput: boolean;
  executions: AgentExecutionResult[];
  library: PromptLibrary;
  requiredLabels: string[];
  missingLabels: string[];
}

export function xlsxPhaseInstructions(input: XlsxPhaseInstructionsInput): readonly string[] {
  const executions = xlsxProcessingExecutions(input.executions);
  return phaseInstructions({
    finalResponse: input.finalResponse,
    hasCleanUnmarkedOutput: hasCleanUnmarkedOutput(executions, input.requiredLabels),
    hasCleanLabeledOutput: hasCleanLabeledOutput(
      executions,
      input.requiredLabels,
      input.missingLabels,
    ),
    hasXlsxInput: input.hasXlsxInput,
    library: input.library,
    xlsxPhase: xlsxWorkflowPhase(executions, input.requiredLabels),
  });
}

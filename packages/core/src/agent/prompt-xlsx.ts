import { type AgentExecutionResult, parseXlsxProgress } from "@vault/shared";
import {
  completedSuccessfully,
  type XlsxWorkflowPhase,
  xlsxWorkflowPhase,
} from "./output-contract.js";
import type { AgentPromptInput } from "./prompt.js";
import { XLSX_CONTINUE_PHASE, XLSX_REPAIR_PHASE, XLSX_WORK_PHASE } from "./xlsx-prompt.js";

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
    /\bexcel\b|\.xlsx?\b/iu.test(input.task) ||
    discoveredXlsxForDataTask(input, executions)
  );
}

interface PhaseInstructionInput {
  finalResponse: boolean;
  hasCleanUnmarkedOutput: boolean;
  hasCleanLabeledOutput: boolean;
  hasXlsxInput: boolean;
  xlsxPhase: XlsxWorkflowPhase;
}

function phaseInstructions(input: PhaseInstructionInput): readonly string[] {
  if (input.finalResponse) {
    return [
      "No execution capacity remains. Respond now from the observations. State clearly if the task could not be completed or verified.",
    ];
  }
  if (!input.hasXlsxInput) return [];
  if (input.xlsxPhase === "work") return XLSX_WORK_PHASE;
  if (input.xlsxPhase === "repair") {
    if (input.hasCleanLabeledOutput) {
      return [
        "The last execution produced every requested output label, but it did not prove complete XLSX coverage with the three required VAULT_XLSX progress markers.",
        "Execute corrected source now. Reuse or replace the working calculation, then print FILES_DONE as the fully processed XLSX file count, FILES_TOTAL as the discovered XLSX file count, and COMPLETE=1 only when they are equal and every workbook was read.",
        "Do not respond and do not repeat the unchanged source.",
      ];
    }
    if (input.hasCleanUnmarkedOutput) {
      return [
        "The last execution finished cleanly but did not print all three required VAULT_XLSX progress markers.",
        "Repair or replace the program so every normal exit path, including the 75-second checkpoint path, prints FILES_DONE, FILES_TOTAL, and COMPLETE. Print final output labels only when COMPLETE=1.",
        "Do not repeat the unchanged source.",
      ];
    }
    return XLSX_REPAIR_PHASE;
  }
  if (input.xlsxPhase === "continue") return XLSX_CONTINUE_PHASE;
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
    xlsxPhase: xlsxWorkflowPhase(executions, input.requiredLabels),
  });
}

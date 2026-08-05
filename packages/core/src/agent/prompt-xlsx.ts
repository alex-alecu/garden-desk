import {
  type AgentExecutionResult,
  parseXlsxProgress,
  stripXlsxProgress,
} from "@vault/shared";
import { executionSucceeded } from "./history.js";
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

function unresolvedHistoricalXlsxResult(input: AgentPromptInput): boolean {
  const asksForTable = /\b(?:table|tabel(?:ul)?)\b/iu.test(input.task);
  if (!asksForTable && !/\b(?:results?|rezultate(?:le)?)\b/iu.test(input.task)) return false;
  const latest = input.history?.runs
    .flatMap((run) => run.events)
    .filter(
      (event) =>
        event.type === "execution.completed" &&
        executionSucceeded(event) &&
        parseXlsxProgress(event.stdout ?? "") !== undefined,
    )
    .at(-1);
  if (latest === undefined) return false;
  const stdout = latest.stdout ?? "";
  if (parseXlsxProgress(stdout)?.complete !== true) return false;
  const result = stripXlsxProgress(stdout);
  if (asksForTable) return !/^\|.+\|\r?\n\|(?:\s*:?-+:?\s*\|)+$/mu.test(result);
  return result.length === 0;
}

export function requiresXlsxWorkflow(
  input: AgentPromptInput,
  executions: AgentExecutionResult[] = [],
): boolean {
  return (
    (input.inputNames ?? []).some((name) => name.toLowerCase().endsWith(".xlsx")) ||
    /\b(?:excel|xlsx)\b|\.xlsx?\b/iu.test(input.task) ||
    discoveredXlsxForDataTask(input, executions) ||
    unresolvedHistoricalXlsxResult(input)
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
  task: string;
}

export function xlsxPhaseInstructions(input: XlsxPhaseInstructionsInput): readonly string[] {
  const executions = xlsxProcessingExecutions(input.executions);
  const instructions = phaseInstructions({
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
  const latest = executions.at(-1);
  return latest !== undefined &&
    /\b(?:table|tabel(?:ul)?)\b/iu.test(input.task) &&
    /(?:unterminated string literal|invalid escape sequence|'Worksheet' object has no attribute 'reset_dimensions')/iu.test(
      latest.stderr,
    )
    ? [...instructions, input.library.recovery("xlsx-table")]
    : instructions;
}

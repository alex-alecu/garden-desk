import { stripWorkProgress } from "@vault/shared";
import { requestedArtifactNames, requestedFactLabels } from "./artifact-declarations.js";
import { requestsDirectTable, requestsOverflowArtifact } from "./output-contract.js";
import type { AgentProgress, AgentPromptInput } from "./prompt.js";
import type { PromptLibrary } from "./prompt-library.js";

export interface WorkflowShapeInput {
  activeNames: ReadonlySet<string>;
  input: AgentPromptInput;
  latestStdout?: string;
  phase: "work" | "repair" | "continue" | "complete";
  progress: AgentProgress;
  requiredLabels: string[];
  skillName: string;
}

function requestsTable(task: string): boolean {
  return /\b(?:table|tabel(?:ul)?)\b/iu.test(task);
}

function directTableShape(options: WorkflowShapeInput, library: PromptLibrary): readonly string[] {
  return options.phase !== "complete" && requestsDirectTable(options.input.task)
    ? [library.skillRecovery(options.skillName, "direct-table-program-shape")]
    : [];
}

function overflowShape(options: WorkflowShapeInput, library: PromptLibrary): readonly string[] {
  const oversized =
    options.latestStdout !== undefined && stripWorkProgress(options.latestStdout).length > 64_000;
  return requestsOverflowArtifact(options.input.task) || oversized
    ? [library.skillRecovery(options.skillName, "program-shape")]
    : [];
}

function aggregateShape(options: WorkflowShapeInput, library: PromptLibrary): readonly string[] {
  const aggregateOnly =
    options.requiredLabels.length > 0 &&
    requestedArtifactNames(options.input.task).length === 0 &&
    !requestsTable(options.input.task);
  return options.phase !== "complete" && aggregateOnly
    ? [library.skillRecovery(options.skillName, "analysis-program-shape")]
    : [];
}

function multiFormatShape(options: WorkflowShapeInput, library: PromptLibrary): readonly string[] {
  return options.phase !== "complete" &&
    options.progress.executions.length === 0 &&
    options.activeNames.size > 1 &&
    requestedFactLabels(options.input.task).length > 1
    ? [library.skillRecovery(options.skillName, "multi-format-analysis-shape")]
    : [];
}

export function workflowShapePrompts(
  options: WorkflowShapeInput,
  library: PromptLibrary,
): readonly string[] {
  return [
    ...directTableShape(options, library),
    ...overflowShape(options, library),
    ...aggregateShape(options, library),
    ...multiFormatShape(options, library),
  ];
}

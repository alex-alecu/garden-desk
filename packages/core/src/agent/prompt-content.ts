import { type AgentExecutionResult, MAX_GENERATION_TOKENS } from "@vault/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import {
  artifactCandidateNames,
  requestedArtifactNames,
  requestedFactLabels,
} from "./artifact-declarations.js";
import type { DurableAgentHistory } from "./history.js";
import { MAX_AGENT_EXECUTIONS } from "./limits.js";
import { completedSuccessfully, requiredOutputLabels } from "./output-contract.js";
import { compactedTaskState, type LedgerAnchor } from "./prompt-compaction.js";
import { attachmentFiles, selectedInputInstructions } from "./prompt-inputs.js";
import type { PromptLibrary } from "./prompt-library.js";
import { observations } from "./prompt-observations.js";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";

const RUNTIME_CAPABILITIES = Object.entries(capabilities.runtimes)
  .map(([name, version]) => `${name} ${version}`)
  .join(", ");
const TOOL_CAPABILITIES = ["sh", "find", "grep", "sed", "awk", "diff", "patch", "tar"]
  .filter((name) => capabilities.executables.some((path) => path.endsWith(`/${name}`)))
  .join(", ");

export interface PromptContentInput {
  inputNames?: string[];
  modelId: string;
  task: string;
  history?: DurableAgentHistory;
}

export interface PromptContentProgress {
  executions: AgentExecutionResult[];
  ledgerAnchor?: LedgerAnchor;
  lastRejectedProgramReason?: string | undefined;
  rejectedDuplicates: number;
  requestedSkills?: ReadonlySet<string>;
}

function declaredNames(declarations: readonly (string | null | undefined)[]): string[] {
  return declarations.flatMap((declaration) => {
    const value = declaration ?? "";
    return Array.from(
      value.matchAll(/(?:^|[\s"'`(=])([^\s"'`()=]+\.[A-Za-z0-9]{1,16})(?=$|[\s"'`),;])/gu),
      (match) => match[1] ?? "",
    ).filter((name) => name.length > 0);
  });
}

function declaredEvidenceNames(
  executions: AgentExecutionResult[],
  history: DurableAgentHistory | undefined,
): string[] {
  return [
    ...declaredNames(executions.flatMap((execution) => [execution.command, execution.source])),
    ...declaredNames(
      history?.runs.flatMap((run) =>
        run.events.flatMap((event) => [event.command, event.source, event.path]),
      ) ?? [],
    ),
  ];
}

function skillSelection(input: PromptContentInput, progress: PromptContentProgress) {
  const sourceDiscoveryRecovery = progress.lastRejectedProgramReason === "source_allowlist";
  return {
    task: input.task,
    inputNames: input.inputNames ?? [],
    evidenceNames: declaredEvidenceNames(progress.executions, input.history),
    requestedSkillNames: sourceDiscoveryRecovery
      ? ["terminal-commands"]
      : [...(progress.requestedSkills ?? [])],
    suppressProgressSkills: sourceDiscoveryRecovery,
  };
}

export function activePromptSkillNames(
  input: PromptContentInput,
  progress: PromptContentProgress,
  library: PromptLibrary,
): ReadonlySet<string> {
  return library.activeSkillNames(skillSelection(input, progress));
}

export function systemPrompt(
  input: PromptContentInput,
  progress: PromptContentProgress,
  library: PromptLibrary,
): string {
  const selection = skillSelection(input, progress);
  const activeNames = activePromptSkillNames(input, progress, library);
  return library.system("agent", {
    active_skills: library.activeSkills(selection, {
      shell_command_character_limit: SHELL_COMMAND_CHARACTER_LIMIT.toLocaleString("en-US"),
      shell_path: capabilities.shell,
      tool_capabilities: TOOL_CAPABILITIES,
      workspace_path: capabilities.workspaceMount.path,
    }),
    max_generation_tokens: MAX_GENERATION_TOKENS.toLocaleString("en-US"),
    runtime_capabilities: RUNTIME_CAPABILITIES,
    skill_catalog: library.skillCatalog(activeNames),
  });
}

function missingArtifactInstruction(
  input: PromptContentInput,
  progress: PromptContentProgress,
): string {
  const artifacts = artifactCandidateNames(progress.executions);
  const requiredArtifacts = requestedArtifactNames(input.task);
  const missingArtifacts = requiredArtifacts.filter((name) => !artifacts.includes(name));
  const requestedFacts = requestedFactLabels(input.task);
  return [
    requiredArtifacts.length > 0 && progress.executions.length > 0 && requestedFacts.length > 0
      ? `Every requested deliverable must preserve these exact LABEL=value facts: ${JSON.stringify(requestedFacts)}.`
      : "",
    missingArtifacts.length > 0 && progress.executions.length === MAX_AGENT_EXECUTIONS - 1
      ? `Only one execution remains. Derive any missing fact, then create and reopen these deliverables now: ${JSON.stringify(missingArtifacts)}. Do not repeat completed analysis.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function taskStatePrompt(
  input: PromptContentInput,
  progress: PromptContentProgress,
  library: PromptLibrary,
  options: { includeCompaction?: boolean; observationCharacters: number },
): string {
  const { observationCharacters } = options;
  const requiredLabels = requiredOutputLabels(input.task);
  const inputs = attachmentFiles(input.inputNames ?? []);
  const artifacts = artifactCandidateNames(progress.executions);
  const compactedState =
    options.includeCompaction === false
      ? ""
      : compactedTaskState({
          task: input.task,
          executions: progress.executions,
          observationCharacters,
          library,
          anchor: progress.ledgerAnchor,
        });
  return library.system("task-state", {
    artifact_names: JSON.stringify(artifacts),
    observations: JSON.stringify(observations(progress.executions, observationCharacters, library)),
    rejected_duplicates: progress.rejectedDuplicates,
    remaining_execution_capacity: Math.max(0, MAX_AGENT_EXECUTIONS - progress.executions.length),
    required_output_labels: JSON.stringify(requiredLabels),
    missing_artifact_instruction: missingArtifactInstruction(input, progress),
    selected_input_count: inputs.length,
    selected_input_files: JSON.stringify(inputs),
    selected_input_instruction: selectedInputInstructions(input.inputNames ?? [], library).join(
      "\n",
    ),
    successful_execution_count: progress.executions.filter(completedSuccessfully).length,
    task: input.task,
    compacted_state: compactedState,
  });
}

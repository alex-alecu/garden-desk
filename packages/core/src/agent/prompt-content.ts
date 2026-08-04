import { type AgentExecutionResult, MAX_GENERATION_TOKENS } from "@vault/shared";
import capabilities from "../../../workers/images/agent/capabilities.json" with { type: "json" };
import { artifactCandidateNames } from "./artifact-declarations.js";
import { MAX_AGENT_EXECUTIONS } from "./limits.js";
import { completedSuccessfully, requiredOutputLabels } from "./output-contract.js";
import { attachmentFiles, selectedInputInstructions } from "./prompt-inputs.js";
import type { PromptLibrary } from "./prompt-library.js";
import { observations } from "./prompt-observations.js";
import { SHELL_COMMAND_CHARACTER_LIMIT } from "./prompt-schema.js";
import { requiresXlsxWorkflow } from "./prompt-xlsx.js";

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
}

export interface PromptContentProgress {
  executions: AgentExecutionResult[];
  rejectedDuplicates: number;
}

function skillSelection(input: PromptContentInput, progress: PromptContentProgress) {
  return {
    task: input.task,
    inputNames: input.inputNames ?? [],
    requiredSkillNames: requiresXlsxWorkflow(input, progress.executions) ? ["xlsx-workbooks"] : [],
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

export function taskStatePrompt(
  input: PromptContentInput,
  progress: PromptContentProgress,
  library: PromptLibrary,
  observationCharacters: number,
): string {
  const requiredLabels = requiredOutputLabels(input.task);
  const inputs = attachmentFiles(input.inputNames ?? []);
  const artifacts = artifactCandidateNames(progress.executions);
  return library.system("task-state", {
    artifact_names: JSON.stringify(artifacts),
    observations: JSON.stringify(observations(progress.executions, observationCharacters, library)),
    rejected_duplicates: progress.rejectedDuplicates,
    remaining_execution_capacity: Math.max(0, MAX_AGENT_EXECUTIONS - progress.executions.length),
    required_output_labels: JSON.stringify(requiredLabels),
    selected_input_count: inputs.length,
    selected_input_files: JSON.stringify(inputs),
    selected_input_instruction: selectedInputInstructions(input.inputNames ?? [], library).join(
      "\n",
    ),
    successful_execution_count: progress.executions.filter(completedSuccessfully).length,
    task: input.task,
  });
}

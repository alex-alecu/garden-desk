import { artifactCandidateNames, requestedArtifactNames } from "./artifact-declarations.js";
import { requiredOutputLabels } from "./output-contract.js";
import { activePromptSkillNames } from "./prompt-content.js";
import { attachmentsAlreadyRead } from "./prompt-inputs.js";
import { defaultPromptLibrary, type PromptLibrary } from "./prompt-library.js";
import { needsProgressExecution } from "./prompt-progress.js";
import {
  agentDecisionJsonSchema,
  GENERATION_LIMIT_RECOVERY_SOURCE_LINES,
} from "./prompt-schema.js";
import type { AgentProgress, AgentPromptInput } from "./prompt-types.js";

export type GenerationRecovery = "generation_limit" | undefined;

export function needsShellSourceRepair(progress: AgentProgress): boolean {
  if (progress.sourceExecutionRequired === true) return true;
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

export function needsSourceDiscoveryRepair(
  input: AgentPromptInput,
  progress: AgentProgress,
  library: PromptLibrary,
): boolean {
  if (!activePromptSkillNames(input, progress, library).has("terminal-commands")) return false;
  const latest = progress.executions.at(-1);
  return (
    latest !== undefined &&
    (latest.exitCode !== 0 ||
      latest.termination !== "completed" ||
      latest.stderr.trim().length > 0 ||
      latest.stdout.trim().length === 0)
  );
}

function recoverySourceLineLimit(
  generationLimitRecovery: boolean,
  rejection: AgentProgress["lastRejectedProgramReason"],
  sourceObservationRecovery: boolean,
): { sourceLineLimit?: number } {
  if (generationLimitRecovery) return { sourceLineLimit: GENERATION_LIMIT_RECOVERY_SOURCE_LINES };
  if (rejection === "source_allowlist" || sourceObservationRecovery) return { sourceLineLimit: 40 };
  if (rejection !== undefined && rejection !== "duplicate") return { sourceLineLimit: 40 };
  return {};
}

function sourceDiscoveryOnly(input: AgentPromptInput, progress: AgentProgress): AgentPromptInput {
  if (progress.lastRejectedProgramReason !== "source_allowlist") return input;
  return { ...input, task: "Inspect the selected source tree and locate the requested evidence." };
}

function requestedArtifactMissing(task: string, artifactNames: string[]): boolean {
  return requestedArtifactNames(task).some((name) => !artifactNames.includes(name));
}

function attachmentExecutionRequired(
  finalResponse: boolean,
  progress: AgentProgress,
  input: AgentPromptInput,
): boolean {
  const names = input.inputNames ?? [];
  return (
    !finalResponse &&
    progress.executions.length === 0 &&
    names.length > 0 &&
    !attachmentsAlreadyRead(names, input.history)
  );
}

export function generationSchema(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  recovery: GenerationRecovery,
) {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const schemaInput = sourceDiscoveryOnly(input, progress);
  const progressExecution = needsProgressExecution({
    finalResponse,
    progress,
    requiredLabels: requiredOutputLabels(schemaInput.task),
    library,
    input: schemaInput,
  });
  const generationLimitRecovery = recovery === "generation_limit" && !finalResponse;
  const rejection = progress.lastRejectedProgramReason;
  const sourceDiscoveryRecovery = rejection === "source_allowlist" && !finalResponse;
  const rejectedProgramRecovery =
    rejection !== undefined && rejection !== "duplicate" && !finalResponse;
  const sourceObservationRecovery = needsSourceDiscoveryRepair(input, progress, library);
  const deliverableRecovery = progress.deliverableExecutionRequired === true && !finalResponse;
  const artifactNames = artifactCandidateNames(progress.executions);
  const requiresSourceExecution =
    progressExecution ||
    attachmentExecutionRequired(finalResponse, progress, input) ||
    needsShellSourceRepair(progress) ||
    sourceObservationRecovery ||
    sourceDiscoveryRecovery ||
    rejectedProgramRecovery ||
    deliverableRecovery ||
    requestedArtifactMissing(input.task, artifactNames) ||
    generationLimitRecovery;
  return agentDecisionJsonSchema({
    artifactNames,
    skillNames: library.skillNames(),
    task: schemaInput.task,
    finalResponse,
    requiresSourceExecution,
    ...recoverySourceLineLimit(generationLimitRecovery, rejection, sourceObservationRecovery),
  });
}

import {
  artifactCandidateNames,
  requestedArtifactNames,
  requestedFactLabels,
} from "./artifact-declarations.js";
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
      (latest.termination !== "completed" && latest.termination !== "resource_limit") ||
      latest.stderr.trim().length > 0 ||
      latest.stdout.trim().length === 0)
  );
}

function needsExpandedDeliverableRecovery(
  rejection: AgentProgress["lastRejectedProgramReason"],
  deliverableSkillActive: boolean,
): boolean {
  return (
    deliverableSkillActive &&
    (rejection === "invalid" || rejection === "unterminated_source_string")
  );
}

interface RecoverySourceLimitInput {
  deliverableSkillActive: boolean;
  generationLimitRecovery: boolean;
  progressExecution: boolean;
  rejection: AgentProgress["lastRejectedProgramReason"];
  sourceObservationRecovery: boolean;
}

const RECOVERY_SOURCE_LINES: Partial<
  Record<NonNullable<AgentProgress["lastRejectedProgramReason"]>, number>
> = {
  progress_inside_loop: 64,
  progress_markers: 80,
  table_truncation: 80,
  unsupported_document_api: 100,
};

function progressSourceLineLimit(options: RecoverySourceLimitInput): number | undefined {
  if (!options.progressExecution) return undefined;
  if (options.rejection === "invalid" || options.rejection === "unterminated_source_string") {
    return 64;
  }
  return options.rejection === undefined ? 80 : undefined;
}

function recoverySourceLineLimit(options: RecoverySourceLimitInput): {
  sourceLineLimit?: number;
} {
  if (options.generationLimitRecovery) {
    return { sourceLineLimit: GENERATION_LIMIT_RECOVERY_SOURCE_LINES };
  }
  const progressLimit = progressSourceLineLimit(options);
  if (progressLimit !== undefined) return { sourceLineLimit: progressLimit };
  if (needsExpandedDeliverableRecovery(options.rejection, options.deliverableSkillActive)) {
    return { sourceLineLimit: 100 };
  }
  if (options.sourceObservationRecovery) return { sourceLineLimit: 40 };
  const fixed =
    options.rejection === undefined ? undefined : RECOVERY_SOURCE_LINES[options.rejection];
  if (fixed !== undefined) return { sourceLineLimit: fixed };
  return options.rejection !== undefined && options.rejection !== "duplicate"
    ? { sourceLineLimit: 40 }
    : {};
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

function currentArtifactNames(input: AgentPromptInput, progress: AgentProgress): string[] {
  return artifactCandidateNames(progress.executions, requestedFactLabels(input.task));
}

export function generationSchema(
  input: AgentPromptInput,
  progress: AgentProgress,
  finalResponse: boolean,
  recovery: GenerationRecovery,
) {
  const library = input.promptLibrary ?? defaultPromptLibrary();
  const schemaInput = sourceDiscoveryOnly(input, progress);
  const activeNames = activePromptSkillNames(schemaInput, progress, library);
  const deliverableSkillActive = library.deliverableSkill(activeNames) !== undefined;
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
  const artifactNames = currentArtifactNames(input, progress);
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
    ...recoverySourceLineLimit({
      deliverableSkillActive,
      generationLimitRecovery,
      progressExecution,
      rejection,
      sourceObservationRecovery,
    }),
  });
}

import type { AgentProgress } from "./prompt.js";
import type { PromptLibrary } from "./prompt-library.js";

function progressRejectionInstructions(
  reason: AgentProgress["lastRejectedProgramReason"],
  library: PromptLibrary,
): readonly string[] | undefined {
  if (reason === "progress_inside_loop") return [library.recovery("progress-inside-loop")];
  return reason === "progress_markers" ? [library.recovery("progress-markers")] : undefined;
}

function sourceRecoveryInstructions(
  name: "invalid-program" | "unterminated-source-string",
  library: PromptLibrary,
  progressSkillName: string | undefined,
): readonly string[] {
  const skill =
    progressSkillName === undefined
      ? []
      : [library.skillRecovery(progressSkillName, "program-shape")];
  return [library.recovery(name), ...skill];
}

export function rejectionInstructions(
  progress: AgentProgress,
  library: PromptLibrary,
  progressSkillName?: string,
): readonly string[] {
  if (progress.deliverableExecutionRequired === true) {
    return [library.recovery("unbacked-response")];
  }
  if (progress.lastRejectedProgramReason === "shell_limit") {
    return [library.recovery("shell-limit", { shell_command_character_limit: "4,096" })];
  }
  if (progress.lastRejectedProgramReason === "shell_source") {
    return [library.recovery("shell-source")];
  }
  if (progress.lastRejectedProgramReason === "source_allowlist") {
    return [library.recovery("source-allowlist")];
  }
  if (progress.lastRejectedProgramReason === "unsupported_document_api") {
    return [library.recovery("unsupported-document-api")];
  }
  const progressRecovery = progressRejectionInstructions(
    progress.lastRejectedProgramReason,
    library,
  );
  if (progressRecovery !== undefined) return progressRecovery;
  if (progress.lastRejectedProgramReason === "table_truncation") {
    return [library.recovery("table-truncation")];
  }
  if (progress.lastRejectedProgramReason === "unterminated_source_string") {
    return sourceRecoveryInstructions("unterminated-source-string", library, progressSkillName);
  }
  if (progress.lastRejectedProgramReason === "invalid") {
    return sourceRecoveryInstructions("invalid-program", library, progressSkillName);
  }
  if (progress.lastRejectedProgramReason === "duplicate") {
    return [library.recovery("duplicate")];
  }
  return [];
}

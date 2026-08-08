import type { AgentProgress } from "./prompt.js";
import type { PromptLibrary } from "./prompt-library.js";

export function rejectionInstructions(
  progress: AgentProgress,
  library: PromptLibrary,
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
  if (progress.lastRejectedProgramReason === "unterminated_source_string") {
    return [library.recovery("unterminated-source-string")];
  }
  if (progress.lastRejectedProgramReason === "invalid") {
    return [library.recovery("invalid-program")];
  }
  if (progress.lastRejectedProgramReason === "duplicate") {
    return [library.recovery("duplicate")];
  }
  return [];
}

import type { AgentProgress } from "./prompt.js";

export function rejectionInstructions(progress: AgentProgress): readonly string[] {
  if (progress.lastRejectedProgramReason === "shell_limit") {
    return [
      "The most recent shell command reached the 4,096-character command limit and may have been truncated, so it was not executed.",
      "Do not shorten or repeat that shell command. Submit a Python or Node source action instead; Vault Desk writes the complete source to a workspace file and executes it.",
    ];
  }
  if (progress.lastRejectedProgramReason === "invalid") {
    return [
      "The most recent proposal was rejected because its source was only imports or was pathologically repetitive.",
      "Do not repeat or extend that fragment. Name a materially different strategy in the summary, then submit its complete executable body with each required import listed once.",
    ];
  }
  if (progress.lastRejectedProgramReason === "duplicate") {
    return [
      "The most recent proposal duplicated a program that did not make new verified progress. Use a materially different repair or strategy.",
    ];
  }
  return [];
}

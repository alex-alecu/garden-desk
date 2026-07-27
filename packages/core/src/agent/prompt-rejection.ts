import type { AgentProgress } from "./prompt.js";

export function rejectionInstructions(progress: AgentProgress): readonly string[] {
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

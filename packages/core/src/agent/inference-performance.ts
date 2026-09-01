import type { InferencePerformance } from "@gardendesk/shared";

export function emptyPerformance(): InferencePerformance {
  return {
    promptTokens: 0,
    outputTokens: 0,
    promptDurationMs: 0,
    generationDurationMs: 0,
    totalDurationMs: 0,
  };
}

export function addPerformance(total: InferencePerformance, next: InferencePerformance): void {
  total.promptTokens += next.promptTokens;
  total.outputTokens += next.outputTokens;
  total.promptDurationMs += next.promptDurationMs;
  total.generationDurationMs += next.generationDurationMs;
  total.totalDurationMs += next.totalDurationMs;
}

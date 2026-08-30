import type { AgentRunPerformance, AgentRunResult } from "@vault/shared";
import type { InferenceService } from "../runtime/inference.js";
import { inferenceFailureCode } from "../runtime/inference-errors.js";

export async function inferenceRunContext(
  inference: Partial<Pick<InferenceService, "modelStatus">>,
): Promise<{ knownContextTokens?: number; modelNeedsLoad: boolean }> {
  try {
    const status = await inference.modelStatus?.();
    return {
      ...(typeof status?.contextSizeTokens !== "number"
        ? {}
        : { knownContextTokens: status.contextSizeTokens }),
      modelNeedsLoad: status?.state === "unloaded",
    };
  } catch {
    return { modelNeedsLoad: false };
  }
}

export function tokenRate(tokens: number, milliseconds: number): number {
  return milliseconds <= 0 ? 0 : tokens / (milliseconds / 1_000);
}

export function runPerformance(
  result: Pick<AgentRunResult, "inference">,
  createdAt: string,
): AgentRunPerformance {
  return {
    promptTokens: result.inference.promptTokens,
    outputTokens: result.inference.outputTokens,
    tokensPerSecond: tokenRate(
      result.inference.outputTokens,
      result.inference.generationDurationMs,
    ),
    promptTokensPerSecond: tokenRate(
      result.inference.promptTokens,
      result.inference.promptDurationMs,
    ),
    totalDurationMs: Math.max(0, Date.now() - Date.parse(createdAt)),
  };
}

export function agentFailureText(error: unknown): string {
  if (inferenceFailureCode(error) === "out_of_memory") return "agent_memory_unavailable";
  const message = error instanceof Error ? error.message : "";
  if (/memory/iu.test(message)) return "agent_memory_unavailable";
  if (/model|inference/iu.test(message)) return "agent_model_failed";
  if (/^[a-z][a-z0-9_]{0,127}$/u.test(message)) return message;
  return "agent_run_failed";
}

function failureSummary(detail: string): string {
  if (detail === "agent_context_exhausted") {
    return "The required conversation and repair context no longer fits in the local model window.";
  }
  if (detail === "worker_input_limit_exceeded") {
    return "The selected files exceed this task's supported input limit.";
  }
  if (detail === "agent_generation_limit") {
    return "The answer exceeded the local model's output limit.";
  }
  if (detail === "agent_memory_unavailable") {
    return "The local model needs more available memory to complete this task.";
  }
  if (detail === "agent_model_failed") {
    return "The local model could not be loaded or did not respond.";
  }
  return "The local task could not be completed safely.";
}

export function agentFailureEvent(cancelled: boolean, detail: string) {
  if (cancelled) return { type: "run.cancelled" as const, summary: "Task cancelled.", detail: {} };
  return {
    type: "run.failed" as const,
    summary: failureSummary(detail),
    detail: { stderr: detail },
  };
}

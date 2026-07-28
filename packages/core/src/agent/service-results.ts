export function tokenRate(tokens: number, milliseconds: number): number {
  return milliseconds <= 0 ? 0 : tokens / (milliseconds / 1_000);
}

export function agentFailureText(error: unknown): string {
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
  if (detail === "agent_memory_unavailable") {
    return "The local model needs more available memory to complete this task.";
  }
  if (detail === "agent_model_failed") {
    return "The local model could not be loaded or did not respond.";
  }
  if (detail === "agent_stalled_duplicate") {
    return "The local model repeated the same program and could not make further progress.";
  }
  if (detail === "agent_decision_limit_exceeded") {
    return "The local model could not produce a new executable plan within the planning limit.";
  }
  if (detail === "agent_generation_limit") {
    return "The local model reached its generation limit again while trying a smaller workspace step.";
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

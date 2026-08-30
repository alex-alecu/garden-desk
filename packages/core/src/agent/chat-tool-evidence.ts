import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatToolCall,
} from "@vault/shared";
import type { ArtifactExecutionEvidence } from "./artifact-results.js";
import type { ChatToolState } from "./chat-tool-turn.js";
import type { AgentToolResult, ToolValidation } from "./generic-tools.js";
import { toolCompletedSummary } from "./tool-summaries.js";

type ToolEventWriter = (
  type: AgentEventType,
  summary: string,
  detail?: Partial<AgentEventDetail>,
) => void;

export function validatedEvidenceCall(
  call: ChatToolCall,
  validation?: ToolValidation,
): ChatToolCall {
  return {
    ...call,
    params: validation?.status === "valid" ? validation.parsed : {},
  };
}

export function eventDetail(call: ChatToolCall): Partial<AgentEventDetail> {
  const detail = { toolName: call.name, toolCallId: call.id };
  if (typeof call.params !== "object" || call.params === null) return detail;
  const value = call.params as Record<string, unknown>;
  if (call.name === "bash" && typeof value.command === "string") {
    return { ...detail, command: value.command };
  }
  if (call.name === "python" || call.name === "node") {
    return {
      ...detail,
      language: call.name,
      source: typeof value.source === "string" ? value.source : null,
      path: typeof value.path === "string" ? value.path : null,
    };
  }
  return detail;
}

export function pathOnlyCodeCall(call: ChatToolCall): boolean {
  if (call.name !== "python" && call.name !== "node") return false;
  if (typeof call.params !== "object" || call.params === null) return false;
  const params = call.params as Record<string, unknown>;
  return typeof params.path === "string" && params.source === undefined;
}

function emitCompletedExecutionAttempt(
  onEvent: ToolEventWriter | undefined,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  const attempt = result.executionAttempt;
  if (attempt === undefined) return;
  const detail = {
    ...eventDetail(call),
    language: attempt.language,
    path: attempt.path,
    source: attempt.source,
    command: attempt.command,
  };
  if (pathOnlyCodeCall(call)) onEvent?.("execution.started", "Running code.", detail);
  onEvent?.("execution.completed", "This step could not be completed.", {
    ...detail,
    exitCode: attempt.exitCode,
    stdout: attempt.stdout,
    stderr: attempt.stderr,
    durationMs: attempt.durationMs,
    termination: attempt.termination,
  });
}

/** Records a completed code or shell execution as evidence for the run's UI timeline and audit. */
export function recordCompletedExecution(
  state: ChatToolState,
  onEvent: ToolEventWriter | undefined,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  if (result.execution === undefined) {
    emitCompletedExecutionAttempt(onEvent, call, result);
    return;
  }
  if (pathOnlyCodeCall(call)) {
    onEvent?.("execution.started", "Running code.", {
      ...eventDetail(call),
      language: result.execution.language,
      path: result.execution.path,
      source: result.execution.source,
    });
  }
  state.executions.push(result.execution);
  onEvent?.(
    "execution.completed",
    result.failed ? "This step could not be completed." : "Finished this step.",
    {
      ...eventDetail(call),
      exitCode: result.execution.exitCode,
      stdout: result.execution.stdout,
      stderr: result.execution.stderr,
      durationMs: result.execution.durationMs,
      termination: result.execution.termination,
    },
  );
}

export function emitCompletedTool(
  onEvent: ToolEventWriter | undefined,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  const detail = { toolName: call.name, toolCallId: call.id, stdout: result.content };
  onEvent?.("tool.completed", toolCompletedSummary(call, result.failed), detail);
  if (call.name === "task") {
    onEvent?.(
      "subagent.completed",
      result.failed ? "Sub-agent failed." : "Sub-agent completed.",
      detail,
    );
  }
}

function artifactEvidence(execution: {
  artifacts: AgentExecutionResult["artifacts"];
  invalidatedArtifactPaths?: AgentExecutionResult["invalidatedArtifactPaths"];
  recoverableArtifactPaths?: AgentExecutionResult["recoverableArtifactPaths"];
}): ArtifactExecutionEvidence {
  return {
    artifacts: execution.artifacts,
    ...(execution.invalidatedArtifactPaths === undefined
      ? {}
      : { invalidatedArtifactPaths: execution.invalidatedArtifactPaths }),
    ...(execution.recoverableArtifactPaths === undefined
      ? {}
      : { recoverableArtifactPaths: execution.recoverableArtifactPaths }),
  };
}

/**
 * Every file an execution reports under `/workspace` is retained as run artifact evidence, along
 * with the paths it invalidated or left for a live final read.
 */
export function retainWorkspaceEvidence(state: ChatToolState, result: AgentToolResult): void {
  for (const execution of result.artifactExecutions ?? []) {
    state.artifactExecutions.push(artifactEvidence(execution));
  }
  const artifactExecution = result.execution ?? result.artifactExecution;
  if (artifactExecution !== undefined) {
    state.artifactExecutions.push(artifactEvidence(artifactExecution));
  }
}

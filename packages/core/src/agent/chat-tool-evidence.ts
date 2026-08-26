import {
  type AgentEventDetail,
  type AgentEventType,
  AgentWorkspacePathSchema,
  type ChatToolCall,
} from "@vault/shared";
import type { ArtifactExecutionEvidence } from "./artifact-results.js";
import type { ChatToolState } from "./chat-tool-turn.js";
import type { AgentToolResult } from "./generic-tools.js";

type ToolEventWriter = (
  type: AgentEventType,
  summary: string,
  detail?: Partial<AgentEventDetail>,
) => void;

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

function codeLanguage(call: ChatToolCall): "python" | "node" | undefined {
  if (call.name === "python" || call.name === "node") return call.name;
  return undefined;
}

function reusableScriptPath(call: ChatToolCall, result: AgentToolResult): string | undefined {
  const language = codeLanguage(call);
  if (language === undefined) return undefined;
  if (typeof call.params !== "object" || call.params === null) return undefined;
  const requested = (call.params as Record<string, unknown>).path;
  if (typeof requested !== "string") return undefined;
  const execution =
    result.execution ?? (pathOnlyCodeCall(call) ? result.executionAttempt : undefined);
  if (execution?.language !== language) return undefined;
  if (pathOnlyCodeCall(call) && execution.path !== requested) return undefined;
  const parsed = AgentWorkspacePathSchema.safeParse(requested);
  return parsed.success ? parsed.data : undefined;
}

export function emitCompletedExecutionAttempt(
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

function completedExecutionFailure(result: AgentToolResult): ChatToolState["lastExecutionFailure"] {
  const attempt = result.executionAttempt;
  if (attempt === undefined) return result.executionFailure;
  return {
    termination: attempt.termination ?? "crash",
    exitCode: attempt.exitCode,
    errorText: result.content,
  };
}

function artifactEvidence(
  execution: NonNullable<AgentToolResult["artifactExecution"]>,
): ArtifactExecutionEvidence {
  return {
    artifacts: execution.artifacts,
    exitCode: execution.exitCode,
    termination: execution.termination,
    ...(execution.invalidatedArtifactPaths === undefined
      ? {}
      : { invalidatedArtifactPaths: execution.invalidatedArtifactPaths }),
    ...(execution.recoverableArtifactPaths === undefined
      ? {}
      : { recoverableArtifactPaths: execution.recoverableArtifactPaths }),
  };
}

export function retainWorkspaceEvidence(
  state: ChatToolState,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  const artifactExecution = result.execution ?? result.artifactExecution;
  if (artifactExecution !== undefined)
    state.artifactExecutions.push(artifactEvidence(artifactExecution));
  const path = reusableScriptPath(call, result);
  if (path !== undefined) {
    state.scriptPaths = [...state.scriptPaths.filter((item) => item !== path), path].slice(-8);
  }
  const failure = completedExecutionFailure(result);
  if (failure !== undefined) {
    state.lastExecutionFailure = {
      ...failure,
      errorText: failure.errorText.slice(0, 400),
    };
  }
}

import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatMessage,
  ChatToolCall,
} from "@vault/shared";
import {
  containsProtocolTransition,
  recoverJsonArrayBeforeProtocolTransition,
} from "./chat-protocol.js";
import type { AgentToolResult, GenericToolRegistry } from "./generic-tools.js";
import { subagentTitle, toolCompletedSummary, toolStartedSummary } from "./tool-summaries.js";

const EXECUTION_LIMIT = 24;
const DOOM_LOOP_COUNT = 3;
const MAX_PARALLEL_TASKS = 2;
const GUEST_TOOLS = new Set(["bash", "python", "node", "read", "glob", "grep", "list"]);
const CODE_TOOLS = new Set(["bash", "python", "node"]);

export interface ChatToolState {
  checkpoint: number;
  executions: AgentExecutionResult[];
  failedTools: number;
  guestExecutions: number;
  messages: ChatMessage[];
  signatures: string[];
}

interface ToolTurnInput {
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  registry: GenericToolRegistry;
  state: ChatToolState;
}

function eventDetail(call: ChatToolCall): Partial<AgentEventDetail> {
  const detail = { toolName: call.name, toolCallId: call.id };
  if (typeof call.params !== "object" || call.params === null) return detail;
  const value = call.params as Record<string, unknown>;
  if (call.name === "bash" && typeof value.command === "string") {
    return { ...detail, command: value.command };
  }
  if ((call.name === "python" || call.name === "node") && typeof value.source === "string") {
    return {
      ...detail,
      language: call.name,
      source: value.source,
      path: typeof value.path === "string" ? value.path : null,
    };
  }
  return detail;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function repeatedCall(state: ChatToolState, call: ChatToolCall): boolean {
  const signature = `${call.name}:${stable(call.params)}`;
  state.signatures.push(signature);
  return (
    state.signatures.length >= DOOM_LOOP_COUNT &&
    state.signatures.slice(-DOOM_LOOP_COUNT).every((item) => item === signature)
  );
}

function beforeExecution(
  input: ToolTurnInput,
  call: ChatToolCall,
  repeated: boolean,
  executable: boolean,
): void {
  const detail = eventDetail(call);
  input.onEvent?.("tool.started", toolStartedSummary(call), detail);
  if (call.name === "task" && executable) {
    input.onEvent?.("subagent.started", subagentTitle(call), detail);
  }
  if (CODE_TOOLS.has(call.name) && !repeated && executable) {
    input.onEvent?.("execution.started", "Running code.", detail);
  }
}

function completedExecution(
  input: ToolTurnInput,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  if (result.execution === undefined) return;
  input.state.executions.push(result.execution);
  input.onEvent?.(
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

function completedTool(input: ToolTurnInput, call: ChatToolCall, result: AgentToolResult): void {
  const detail = { toolName: call.name, toolCallId: call.id, stdout: result.content };
  input.onEvent?.("tool.completed", toolCompletedSummary(call, result.failed), detail);
  if (call.name === "task") {
    input.onEvent?.(
      "subagent.completed",
      result.failed ? "Sub-agent failed." : "Sub-agent completed.",
      detail,
    );
  }
}

function blockedResult(message: string): AgentToolResult {
  return { content: message, failed: true };
}

function invalidInputResult(message: string): AgentToolResult {
  return { content: message, failed: true, invalidInput: true };
}

async function toolResult(
  input: ToolTurnInput,
  call: ChatToolCall,
  repeated: boolean,
): Promise<AgentToolResult> {
  if (repeated) {
    return blockedResult(
      "Identical tool call repeated three times. Change approach before trying again.",
    );
  }
  if (GUEST_TOOLS.has(call.name)) {
    if (input.state.guestExecutions >= EXECUTION_LIMIT) {
      return blockedResult(
        "Guest execution limit reached. Finish with the evidence already collected.",
      );
    }
    input.state.guestExecutions += 1;
  }
  return await input.registry.execute(call.name, call.params);
}

function recoverQuestionCall(call: ChatToolCall): void {
  if (call.name !== "question" || typeof call.params !== "object" || call.params === null) {
    return;
  }
  const params = call.params as Record<string, unknown>;
  if (typeof params.questions !== "string") return;
  const questions = recoverJsonArrayBeforeProtocolTransition(params.questions);
  if (questions !== undefined) call.params = { ...params, questions };
}

async function executeToolCall(input: ToolTurnInput, call: ChatToolCall): Promise<boolean> {
  recoverQuestionCall(call);
  const corrupt = containsProtocolTransition(call.params);
  const repeated = corrupt ? false : repeatedCall(input.state, call);
  beforeExecution(input, call, repeated, !corrupt);
  const result = corrupt
    ? invalidInputResult("Invalid tool input: protocol-control transition in arguments.")
    : await toolResult(input, call, repeated);
  finalizeToolCall(input, call, repeated, result);
  return result.invalidInput !== true;
}

/**
 * Applies the ordered side effects of a completed tool call: execution and completion events, the
 * tool result message, the doom-loop note, and failure counting. Kept separate from execution so a
 * group of parallel sub-agent calls can run concurrently yet still fold their results into the
 * conversation and failure counters in the original call order.
 */
function finalizeToolCall(
  input: ToolTurnInput,
  call: ChatToolCall,
  repeated: boolean,
  result: AgentToolResult,
): void {
  completedExecution(input, call, result);
  input.state.messages.push({
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    result: result.content,
  });
  completedTool(input, call, result);
  if (repeated) {
    input.state.messages.push({
      role: "system",
      text: "The same tool call has repeated three times. Change approach and use the new evidence; do not issue it again.",
    });
  }
  input.state.failedTools = result.failed ? input.state.failedTools + 1 : 0;
}

export function initialToolState(messages: ChatMessage[]): ChatToolState {
  return {
    checkpoint: messages.length,
    executions: [],
    failedTools: 0,
    guestExecutions: 0,
    messages,
    signatures: [],
  };
}

const FAILURE_EVIDENCE_LIMIT = 400;

/**
 * Discards the failed direction from live context: truncates messages back to the
 * last checkpointed working state and keeps one short deterministic failure note.
 * Durable execution and trace records are unaffected.
 */
export function rollbackFailedDirection(state: ChatToolState): void {
  const lastFailure = state.messages.findLast((message) => message.role === "tool");
  const evidence = lastFailure?.result.slice(0, FAILURE_EVIDENCE_LIMIT) ?? "(no tool output)";
  state.messages = state.messages.slice(0, state.checkpoint);
  state.messages.push({
    role: "system",
    text: `A direction failed three consecutive tool attempts and was removed from context. Do not retry it. Last failure evidence:\n${evidence}\nContinue from the earlier working state with a materially different approach.`,
  });
  state.checkpoint = state.messages.length;
  state.failedTools = 0;
  state.signatures = [];
}

export async function executeToolCalls(
  input: Omit<ToolTurnInput, "state"> & { state: ChatToolState },
  calls: readonly ChatToolCall[],
): Promise<boolean> {
  let validInput = false;
  let index = 0;
  while (index < calls.length) {
    const call = calls[index];
    if (call === undefined) break;
    const group = consecutiveTaskGroup(calls, index);
    if (group.length > 1) {
      validInput = (await executeTaskGroup(input, group)) || validInput;
      index += group.length;
    } else {
      validInput = (await executeToolCall(input, call)) || validInput;
      index += 1;
    }
  }
  return validInput;
}

/**
 * Collects the run of consecutive `task` calls beginning at `start`, capped so at most
 * {@link MAX_PARALLEL_TASKS} sub-agents run together. A single task, or any non-task tool, is
 * handled by the sequential path.
 */
function consecutiveTaskGroup(calls: readonly ChatToolCall[], start: number): ChatToolCall[] {
  const group: ChatToolCall[] = [];
  for (let i = start; i < calls.length && group.length < MAX_PARALLEL_TASKS; i += 1) {
    const call = calls[i];
    if (call === undefined || call.name !== "task") break;
    group.push(call);
  }
  return group;
}

/**
 * Runs a group of sub-agent `task` calls concurrently on the model's parallel context sequences,
 * then folds their results into the conversation in the original call order so history and failure
 * counting stay deterministic regardless of which sub-agent finished first.
 */
async function executeTaskGroup(input: ToolTurnInput, group: ChatToolCall[]): Promise<boolean> {
  const started = group.map((call) => {
    const corrupt = containsProtocolTransition(call.params);
    const repeated = corrupt ? false : repeatedCall(input.state, call);
    beforeExecution(input, call, repeated, !corrupt);
    const result = corrupt
      ? Promise.resolve(
          invalidInputResult("Invalid tool input: protocol-control transition in arguments."),
        )
      : toolResult(input, call, repeated);
    return { call, repeated, result };
  });
  let validInput = false;
  for (const { call, repeated, result } of started) {
    const completed = await result;
    finalizeToolCall(input, call, repeated, completed);
    validInput = completed.invalidInput !== true || validInput;
  }
  return validInput;
}

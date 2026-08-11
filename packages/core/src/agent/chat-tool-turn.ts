import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatMessage,
  ChatToolCall,
} from "@vault/shared";
import type { AgentToolResult, GenericToolRegistry } from "./generic-tools.js";

const EXECUTION_LIMIT = 24;
const DOOM_LOOP_COUNT = 3;
const GUEST_TOOLS = new Set(["bash", "python", "node", "read", "glob", "grep", "list"]);
const CODE_TOOLS = new Set(["bash", "python", "node"]);

export interface ChatToolState {
  checkpoint: number;
  executions: AgentExecutionResult[];
  failedTools: number;
  guestExecutions: number;
  messages: ChatMessage[];
  responseOnly: boolean;
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

function description(call: ChatToolCall): string {
  if (typeof call.params !== "object" || call.params === null) return "Sub-agent task";
  const value = (call.params as Record<string, unknown>).description;
  return typeof value === "string" ? value : "Sub-agent task";
}

function beforeExecution(input: ToolTurnInput, call: ChatToolCall, repeated: boolean): void {
  const detail = eventDetail(call);
  input.onEvent?.("tool.started", `Using ${call.name}.`, detail);
  if (call.name === "task") input.onEvent?.("subagent.started", description(call), detail);
  if (CODE_TOOLS.has(call.name) && !repeated) {
    input.onEvent?.("execution.started", `Running ${call.name}.`, detail);
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
  input.onEvent?.(
    "tool.completed",
    result.failed ? `${call.name} failed.` : `${call.name} completed.`,
    detail,
  );
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

async function executeToolCall(input: ToolTurnInput, call: ChatToolCall): Promise<void> {
  const repeated = repeatedCall(input.state, call);
  beforeExecution(input, call, repeated);
  const result = await toolResult(input, call, repeated);
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
    responseOnly: false,
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
): Promise<void> {
  for (const call of calls) await executeToolCall(input, call);
}

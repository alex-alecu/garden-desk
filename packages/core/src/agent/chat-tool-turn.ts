import {
  type AgentEventDetail,
  type AgentEventType,
  type AgentExecutionResult,
  AgentWorkspacePathSchema,
  type ChatMessage,
  type ChatToolCall,
} from "@vault/shared";
import { containsProtocolTransition } from "./chat-protocol.js";
import {
  type LoadedSkillCalls,
  liveLoadedSkillNames,
  requestedSkillName,
} from "./chat-skill-state.js";
import {
  alreadyLoadedSkillResult,
  blockedToolResult,
  invalidToolInputResult,
  recoverQuestionCall,
} from "./chat-tool-call-support.js";
import type { AgentToolResult, GenericToolRegistry } from "./generic-tools.js";
import { subagentTitle, toolCompletedSummary, toolStartedSummary } from "./tool-summaries.js";

const EXECUTION_LIMIT = 24;
const DOOM_LOOP_COUNT = 3;
const MAX_PARALLEL_TASKS = 2;
const GUEST_TOOLS = new Set(["bash", "python", "node", "read", "glob", "grep", "list"]);
const CODE_TOOLS = new Set(["bash", "python", "node"]);

export interface ChatToolState {
  executions: AgentExecutionResult[];
  guestExecutions: number;
  lastExecutionFailure?: {
    termination: AgentExecutionResult["termination"];
    exitCode: number;
    errorText: string;
  };
  loadedSkills: LoadedSkillCalls;
  messages: ChatMessage[];
  scriptPaths: string[];
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

function pathOnlyCodeCall(call: ChatToolCall): boolean {
  if (call.name !== "python" && call.name !== "node") return false;
  if (typeof call.params !== "object" || call.params === null) return false;
  const params = call.params as Record<string, unknown>;
  return typeof params.path === "string" && params.source === undefined;
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
  if (CODE_TOOLS.has(call.name) && !pathOnlyCodeCall(call) && !repeated && executable) {
    input.onEvent?.("execution.started", "Running code.", detail);
  }
}

function completedExecution(
  input: ToolTurnInput,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  if (result.execution === undefined) return;
  if (pathOnlyCodeCall(call)) {
    input.onEvent?.("execution.started", "Running code.", {
      ...eventDetail(call),
      language: result.execution.language,
      path: result.execution.path,
      source: result.execution.source,
    });
  }
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
    toolCompletedSummary(call, result.failed, result.status),
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

async function toolResult(
  input: ToolTurnInput,
  call: ChatToolCall,
  repeated: boolean,
): Promise<AgentToolResult> {
  if (repeated) {
    return blockedToolResult(
      "Identical tool call repeated three times. Change approach before trying again.",
    );
  }
  if (GUEST_TOOLS.has(call.name)) {
    if (input.state.guestExecutions >= EXECUTION_LIMIT) {
      return blockedToolResult(
        "Guest execution limit reached. Finish with the evidence already collected.",
      );
    }
  }
  const result = await input.registry.execute(call.name, call.params);
  if (GUEST_TOOLS.has(call.name) && result.guestExecutionAttempted === true) {
    input.state.guestExecutions += 1;
  }
  return result;
}

async function executeToolCall(input: ToolTurnInput, call: ChatToolCall): Promise<boolean> {
  recoverQuestionCall(call);
  const corrupt = containsProtocolTransition(call.params);
  const skillName = requestedSkillName(call);
  const loaded = liveLoadedSkillNames(input.state.loadedSkills, input.state.messages);
  const alreadyLoaded = skillName !== undefined && loaded.has(skillName);
  const repeated = corrupt ? false : repeatedCall(input.state, call);
  const invalid = corrupt ? undefined : input.registry.validate(call.name, call.params);
  beforeExecution(input, call, repeated, !corrupt && invalid === undefined);
  const result = corrupt
    ? invalidToolInputResult("Invalid tool input: protocol-control transition in arguments.")
    : alreadyLoaded && !repeated
      ? alreadyLoadedSkillResult(skillName)
      : (invalid ?? (await toolResult(input, call, repeated)));
  finalizeToolCall(input, call, repeated, result);
  return result.invalidInput !== true;
}

/**
 * Applies the ordered side effects of a completed tool call: execution and completion events, the
 * tool result message, doom-loop note, and workspace evidence. Kept separate from execution so a
 * group of parallel sub-agent calls can run concurrently yet still fold their results into the
 * conversation and failure counters in the original call order.
 */
function finalizeToolCall(
  input: ToolTurnInput,
  call: ChatToolCall,
  repeated: boolean,
  result: AgentToolResult,
): void {
  retainWorkspaceEvidence(input.state, call, result);
  completedExecution(input, call, result);
  input.state.messages.push({
    role: "tool",
    toolCallId: call.id,
    name: call.name,
    result: result.content,
  });
  const skillName = requestedSkillName(call);
  if (skillName !== undefined && !result.failed && result.status !== "already_loaded") {
    input.state.loadedSkills.set(call.id, skillName);
  }
  completedTool(input, call, result);
  if (repeated) {
    input.state.messages.push({
      role: "system",
      text: "The same tool call has repeated three times. Change approach and use the new evidence; do not issue it again.",
    });
  }
}

function retainWorkspaceEvidence(
  state: ChatToolState,
  call: ChatToolCall,
  result: AgentToolResult,
): void {
  if ((call.name === "python" || call.name === "node") && typeof call.params === "object") {
    const path = (call.params as Record<string, unknown> | null)?.path;
    if (typeof path === "string" && AgentWorkspacePathSchema.safeParse(path).success) {
      state.scriptPaths = [...state.scriptPaths.filter((item) => item !== path), path].slice(-8);
    }
  }
  if (result.executionFailure !== undefined) {
    state.lastExecutionFailure = {
      ...result.executionFailure,
      errorText: result.executionFailure.errorText.slice(0, 400),
    };
  }
}

export function initialToolState(messages: ChatMessage[]): ChatToolState {
  return {
    executions: [],
    guestExecutions: 0,
    loadedSkills: new Map(),
    messages,
    scriptPaths: [],
    signatures: [],
  };
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
    const invalid = corrupt ? undefined : input.registry.validate(call.name, call.params);
    beforeExecution(input, call, repeated, !corrupt && invalid === undefined);
    const result = corrupt
      ? Promise.resolve(
          invalidToolInputResult("Invalid tool input: protocol-control transition in arguments."),
        )
      : Promise.resolve(invalid ?? toolResult(input, call, repeated));
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

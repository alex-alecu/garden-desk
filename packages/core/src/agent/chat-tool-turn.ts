import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatMessage,
  ChatToolCall,
} from "@vault/shared";
import type { ArtifactExecutionEvidence } from "./artifact-results.js";
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
import {
  emitCompletedExecutionAttempt,
  eventDetail,
  pathOnlyCodeCall,
  retainWorkspaceEvidence,
  validatedEvidenceCall,
} from "./chat-tool-evidence.js";
import type { AgentToolResult, GenericToolRegistry, ToolValidation } from "./generic-tools.js";
import { GuestExecutionBudget } from "./guest-execution-budget.js";
import { subagentTitle, toolCompletedSummary, toolStartedSummary } from "./tool-summaries.js";

const EXECUTION_LIMIT = 24;
const DOOM_LOOP_COUNT = 3;
const MAX_PARALLEL_TASKS = 2;
const CODE_TOOLS = new Set(["bash", "python", "node"]);
const GUEST_TOOLS = new Set([...CODE_TOOLS, "read", "glob", "grep", "list", "write", "edit"]);

export interface ChatToolState {
  artifactExecutions: ArtifactExecutionEvidence[];
  executions: AgentExecutionResult[];
  guestBudget: GuestExecutionBudget;
  lastExecutionFailure?: {
    termination: AgentExecutionResult["termination"];
    exitCode: number | null;
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

function validationFailure(validation?: ToolValidation): AgentToolResult | undefined {
  return validation?.status === "invalid" ? validation.result : undefined;
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
  if (result.execution === undefined) {
    emitCompletedExecutionAttempt(input.onEvent, call, result);
    return;
  }
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
  validation?: ToolValidation,
): Promise<AgentToolResult> {
  if (repeated) {
    return blockedToolResult(
      "Identical tool call repeated three times. Change approach before trying again.",
    );
  }
  if (GUEST_TOOLS.has(call.name)) {
    if (input.state.guestBudget.remaining === 0) {
      return blockedToolResult(
        "Guest execution limit reached. Finish with the evidence already collected.",
      );
    }
  }
  return await input.registry.execute(call.name, call.params, input.state.guestBudget, validation);
}

async function executeToolCall(input: ToolTurnInput, call: ChatToolCall): Promise<boolean> {
  recoverQuestionCall(call);
  const corrupt = containsProtocolTransition(call.params);
  const skillName = requestedSkillName(call);
  const loaded = liveLoadedSkillNames(input.state.loadedSkills, input.state.messages);
  const alreadyLoaded = skillName !== undefined && loaded.has(skillName);
  const repeated = corrupt ? false : repeatedCall(input.state, call);
  const validation = corrupt ? undefined : input.registry.validate(call.name, call.params);
  const evidenceCall = validatedEvidenceCall(call, validation);
  const invalid = validationFailure(validation);
  const hasBudget = !GUEST_TOOLS.has(call.name) || input.state.guestBudget.remaining > 0;
  beforeExecution(input, evidenceCall, repeated, !corrupt && invalid === undefined && hasBudget);
  const result = corrupt
    ? invalidToolInputResult("Invalid tool input: protocol-control transition in arguments.")
    : alreadyLoaded && !repeated
      ? alreadyLoadedSkillResult(skillName)
      : (invalid ?? (await toolResult(input, call, repeated, validation)));
  finalizeToolCall(input, evidenceCall, repeated, result);
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

export function initialToolState(messages: ChatMessage[]): ChatToolState {
  return {
    artifactExecutions: [],
    executions: [],
    guestBudget: new GuestExecutionBudget(EXECUTION_LIMIT),
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
    const validation = corrupt ? undefined : input.registry.validate(call.name, call.params);
    const evidenceCall = validatedEvidenceCall(call, validation);
    const invalid = validationFailure(validation);
    beforeExecution(input, evidenceCall, repeated, !corrupt && invalid === undefined);
    const result = corrupt
      ? Promise.resolve(
          invalidToolInputResult("Invalid tool input: protocol-control transition in arguments."),
        )
      : Promise.resolve(invalid ?? toolResult(input, call, repeated, validation));
    return { call: evidenceCall, repeated, result };
  });
  let validInput = false;
  for (const { call, repeated, result } of started) {
    const completed = await result;
    finalizeToolCall(input, call, repeated, completed);
    validInput = completed.invalidInput !== true || validInput;
  }
  return validInput;
}

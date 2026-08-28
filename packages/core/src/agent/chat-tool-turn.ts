import type {
  AgentEventDetail,
  AgentEventType,
  AgentExecutionResult,
  ChatMessage,
  ChatToolCall,
} from "@vault/shared";
import type { ArtifactExecutionEvidence } from "./artifact-results.js";
import {
  completeDuplicateCall,
  type DuplicateCallDecision,
  type DuplicateCallOutcome,
  type DuplicateRecoveryState,
  finishDuplicateToolTurn,
  initialDuplicateRecoveryState,
  type ToolTurnOutcome,
  trackDuplicateCall,
} from "./chat-duplicate-recovery.js";
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
  emitCompletedTool,
  eventDetail,
  pathOnlyCodeCall,
  retainCompletedExecution,
  retainWorkspaceEvidence,
  validatedEvidenceCall,
} from "./chat-tool-evidence.js";
import type { AgentToolResult, GenericToolRegistry, ToolValidation } from "./generic-tools.js";
import { GuestExecutionBudget } from "./guest-execution-budget.js";
import { subagentTitle, toolStartedSummary } from "./tool-summaries.js";

const EXECUTION_LIMIT = 24;
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
  duplicateRecovery: DuplicateRecoveryState;
}

interface ToolTurnInput {
  onEvent?(type: AgentEventType, summary: string, detail?: Partial<AgentEventDetail>): void;
  registry: GenericToolRegistry;
  state: ChatToolState;
}

function validationFailure(validation?: ToolValidation): AgentToolResult | undefined {
  return validation?.status === "invalid" ? validation.result : undefined;
}

interface ToolResultOutcome {
  executed: boolean;
  result: AgentToolResult;
}

interface PreparedToolCall {
  corrupt: boolean;
  decision: DuplicateCallDecision | undefined;
  evidenceCall: ChatToolCall;
  invalid: AgentToolResult | undefined;
  validation: ToolValidation | undefined;
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

async function toolResult(
  input: ToolTurnInput,
  call: ChatToolCall,
  blocked: boolean,
  validation?: ToolValidation,
): Promise<ToolResultOutcome> {
  if (blocked) {
    return {
      executed: false,
      result: blockedToolResult(
        "Identical tool call repeated three times. Change approach before trying again.",
      ),
    };
  }
  if (GUEST_TOOLS.has(call.name)) {
    if (input.state.guestBudget.remaining === 0) {
      return {
        executed: false,
        result: blockedToolResult(
          "Guest execution limit reached. Finish with the evidence already collected.",
        ),
      };
    }
  }
  return {
    executed: true,
    result: await input.registry.execute(
      call.name,
      call.params,
      input.state.guestBudget,
      validation,
    ),
  };
}

function prepareToolCall(input: ToolTurnInput, call: ChatToolCall): PreparedToolCall {
  recoverQuestionCall(call);
  const corrupt = containsProtocolTransition(call.params);
  const validation = corrupt ? undefined : input.registry.validate(call.name, call.params);
  const evidenceCall = validatedEvidenceCall(call, validation);
  const decision = corrupt
    ? undefined
    : trackDuplicateCall(
        input.state.duplicateRecovery,
        validation?.status === "valid" ? evidenceCall : call,
      );
  return {
    corrupt,
    decision,
    evidenceCall,
    invalid: validationFailure(validation),
    validation,
  };
}

async function resolvePreparedTool(
  input: ToolTurnInput,
  call: ChatToolCall,
  prepared: PreparedToolCall,
  alreadyLoadedSkill: string | undefined,
): Promise<ToolResultOutcome> {
  if (prepared.corrupt) {
    return {
      executed: false,
      result: invalidToolInputResult(
        "Invalid tool input: protocol-control transition in arguments.",
      ),
    };
  }
  if (alreadyLoadedSkill !== undefined && !prepared.decision?.blocked) {
    return { executed: false, result: alreadyLoadedSkillResult(alreadyLoadedSkill) };
  }
  if (prepared.invalid !== undefined) return { executed: false, result: prepared.invalid };
  return await toolResult(input, call, prepared.decision?.blocked ?? false, prepared.validation);
}

async function executeToolCall(
  input: ToolTurnInput,
  call: ChatToolCall,
): Promise<DuplicateCallOutcome> {
  const prepared = prepareToolCall(input, call);
  const skillName = requestedSkillName(call);
  const loaded = liveLoadedSkillNames(input.state.loadedSkills, input.state.messages);
  const alreadyLoadedSkill =
    skillName !== undefined && loaded.has(skillName) ? skillName : undefined;
  const hasBudget = !GUEST_TOOLS.has(call.name) || input.state.guestBudget.remaining > 0;
  beforeExecution(
    input,
    prepared.evidenceCall,
    prepared.decision?.blocked ?? false,
    !prepared.corrupt && prepared.invalid === undefined && hasBudget,
  );
  const completed = await resolvePreparedTool(input, call, prepared, alreadyLoadedSkill);
  finalizeToolCall(input, prepared.evidenceCall, completed.result);
  return completeDuplicateCall(
    input.state.duplicateRecovery,
    prepared.decision,
    completed.executed,
    completed.result.invalidInput !== true,
  );
}

function finalizeToolCall(input: ToolTurnInput, call: ChatToolCall, result: AgentToolResult): void {
  retainWorkspaceEvidence(input.state, call, result);
  retainCompletedExecution(input.state, input.onEvent, call, result);
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
  emitCompletedTool(input.onEvent, call, result);
}

export function initialToolState(messages: ChatMessage[]): ChatToolState {
  return {
    artifactExecutions: [],
    executions: [],
    guestBudget: new GuestExecutionBudget(EXECUTION_LIMIT),
    loadedSkills: new Map(),
    messages,
    scriptPaths: [],
    duplicateRecovery: initialDuplicateRecoveryState(),
  };
}

export async function executeToolCalls(
  input: Omit<ToolTurnInput, "state"> & { state: ChatToolState },
  calls: readonly ChatToolCall[],
): Promise<ToolTurnOutcome> {
  const activeAtStart = input.state.duplicateRecovery.activeBlockedSignature;
  const outcomes: DuplicateCallOutcome[] = [];
  let index = 0;
  while (index < calls.length) {
    const call = calls[index];
    if (call === undefined) break;
    const group = consecutiveTaskGroup(calls, index);
    if (group.length > 1) {
      outcomes.push(...(await executeTaskGroup(input, group)));
      index += group.length;
    } else {
      outcomes.push(await executeToolCall(input, call));
      index += 1;
    }
  }
  return finishDuplicateToolTurn(input.state.duplicateRecovery, activeAtStart, outcomes);
}

function consecutiveTaskGroup(calls: readonly ChatToolCall[], start: number): ChatToolCall[] {
  const group: ChatToolCall[] = [];
  for (let i = start; i < calls.length && group.length < MAX_PARALLEL_TASKS; i += 1) {
    const call = calls[i];
    if (call === undefined || call.name !== "task") break;
    group.push(call);
  }
  return group;
}

async function executeTaskGroup(
  input: ToolTurnInput,
  group: ChatToolCall[],
): Promise<DuplicateCallOutcome[]> {
  const started = group.map((call) => {
    const prepared = prepareToolCall(input, call);
    beforeExecution(
      input,
      prepared.evidenceCall,
      prepared.decision?.blocked ?? false,
      !prepared.corrupt && prepared.invalid === undefined,
    );
    return { prepared, result: resolvePreparedTool(input, call, prepared, undefined) };
  });
  const outcomes: DuplicateCallOutcome[] = [];
  for (const { prepared, result } of started) {
    const completed = await result;
    finalizeToolCall(input, prepared.evidenceCall, completed.result);
    outcomes.push(
      completeDuplicateCall(
        input.state.duplicateRecovery,
        prepared.decision,
        completed.executed,
        completed.result.invalidInput !== true,
      ),
    );
  }
  return outcomes;
}

import type { AgentQuestion, ChatMessage, ChatToolCall } from "@vault/shared";
import type { AgentQuestionOutcome } from "./generic-tool-support.js";

export const DISMISSED_RECOVERY_DIRECTION = "Inspect current state before another execution.";

/** Blocked turns sample instead of repeating the greedy output that produced the identical call. */
export const RECOVERY_TEMPERATURE = 0.3;

export const DUPLICATE_RECOVERY_QUESTION: AgentQuestion = {
  header: "Repeated action",
  question:
    "The same action is still repeated after automatic recovery. How should Vault Desk continue?",
  options: [
    {
      label: "Inspect first (Recommended)",
      description: "Use a different inspection action before another execution.",
    },
    {
      label: "Change method",
      description: "Use another available tool or different input.",
    },
  ],
};

interface RecentToolCall {
  callId: string;
  signature: string;
}

export interface DuplicateRecoveryState {
  activeBlockedSignature?: string;
  blockedCalls: number;
  latestUserDirection?: string;
  omittedCallIds: Set<string>;
  recentCalls: RecentToolCall[];
  retainedCallId?: string;
  recoveryTurns: number;
}

export interface DuplicateCallDecision {
  blocked: boolean;
  signature: string;
}

export interface DuplicateCallOutcome {
  blocked: boolean;
  changedApproach: boolean;
  executed: boolean;
  signature?: string;
  validInput: boolean;
}

export interface ToolTurnOutcome {
  executed: boolean;
  recoveryQuestionRequired: boolean;
  validInput: boolean;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

export function initialDuplicateRecoveryState(): DuplicateRecoveryState {
  return { blockedCalls: 0, omittedCallIds: new Set(), recentCalls: [], recoveryTurns: 0 };
}

export function trackDuplicateCall(
  state: DuplicateRecoveryState,
  call: ChatToolCall,
): DuplicateCallDecision {
  const signature = `${call.name}:${stable(call.params)}`;
  state.recentCalls = [...state.recentCalls, { callId: call.id, signature }].slice(-3);
  if (state.activeBlockedSignature === signature) {
    state.omittedCallIds.add(call.id);
    state.blockedCalls += 1;
    return { blocked: true, signature };
  }
  if (state.activeBlockedSignature !== undefined) {
    return { blocked: false, signature };
  }
  const repeated =
    state.recentCalls.length === 3 &&
    state.recentCalls.every((item) => item.signature === signature);
  if (!repeated) return { blocked: false, signature };
  state.activeBlockedSignature = signature;
  state.blockedCalls = 1;
  delete state.latestUserDirection;
  state.recoveryTurns = 0;
  state.omittedCallIds.add(state.recentCalls[0]?.callId ?? call.id);
  state.omittedCallIds.add(call.id);
  const retainedCallId = state.recentCalls[1]?.callId;
  if (retainedCallId !== undefined) state.retainedCallId = retainedCallId;
  return { blocked: true, signature };
}

export function recordDuplicateExecution(
  state: DuplicateRecoveryState,
  signature: string,
): boolean {
  if (state.activeBlockedSignature === undefined || state.activeBlockedSignature === signature) {
    return false;
  }
  delete state.activeBlockedSignature;
  delete state.latestUserDirection;
  delete state.retainedCallId;
  state.blockedCalls = 0;
  state.recoveryTurns = 0;
  return true;
}

export function completeDuplicateCall(
  state: DuplicateRecoveryState,
  decision: DuplicateCallDecision | undefined,
  executed: boolean,
  validInput: boolean,
): DuplicateCallOutcome {
  return {
    blocked: decision?.blocked ?? false,
    changedApproach:
      executed && decision !== undefined
        ? recordDuplicateExecution(state, decision.signature)
        : false,
    executed,
    ...(decision === undefined ? {} : { signature: decision.signature }),
    validInput,
  };
}

export function finishDuplicateToolTurn(
  state: DuplicateRecoveryState,
  activeAtStart: string | undefined,
  outcomes: readonly DuplicateCallOutcome[],
): ToolTurnOutcome {
  const changedApproach = outcomes.some(
    (outcome) =>
      outcome.changedApproach ||
      (activeAtStart !== undefined && outcome.executed && outcome.signature !== activeAtStart),
  );
  const stalled =
    activeAtStart !== undefined &&
    outcomes.length > 0 &&
    !changedApproach &&
    outcomes.every((outcome) => outcome.blocked && outcome.signature === activeAtStart);
  if (stalled) state.recoveryTurns += 1;
  return {
    executed: outcomes.some((outcome) => outcome.executed),
    validInput: outcomes.some((outcome) => outcome.validInput),
    recoveryQuestionRequired: stalled && state.recoveryTurns >= 2,
  };
}

export function applyDuplicateRecoveryDirection(
  state: DuplicateRecoveryState,
  outcome: AgentQuestionOutcome,
): void {
  const answer = outcome.dismissed ? "" : (outcome.answers[0]?.join(", ").trim() ?? "");
  state.latestUserDirection = answer || DISMISSED_RECOVERY_DIRECTION;
  state.recoveryTurns = 0;
}

function cleanedMessage(
  message: ChatMessage,
  omittedCallIds: ReadonlySet<string>,
): ChatMessage | undefined {
  if (message.role === "tool" && omittedCallIds.has(message.toolCallId)) return undefined;
  if (message.role !== "assistant") return message;
  const toolCalls = message.toolCalls.filter((call) => !omittedCallIds.has(call.id));
  if (message.text.length === 0 && toolCalls.length === 0) return undefined;
  return { ...message, toolCalls };
}

export function cleanedDuplicateHistory(
  messages: readonly ChatMessage[],
  state: DuplicateRecoveryState,
): ChatMessage[] {
  return messages
    .map((message) => cleanedMessage(message, state.omittedCallIds))
    .filter((message): message is ChatMessage => message !== undefined);
}

function recoveryInstruction(
  state: DuplicateRecoveryState,
  messages: readonly ChatMessage[],
): string {
  const retained = messages.find(
    (message) => message.role === "tool" && message.toolCallId === state.retainedCallId,
  );
  const errorLine =
    retained?.role === "tool"
      ? retained.result
          .split("\n")
          .findLast((line) => /error/iu.test(line))
          ?.trim()
          .slice(0, 200)
      : undefined;
  const failure = errorLine === undefined ? "" : ` and failed with: ${errorLine}`;
  const rejected = `${state.blockedCalls} later identical ${state.blockedCalls === 1 ? "call was" : "calls were"} rejected without running`;
  return `The repeated action is blocked: this exact call was already made twice with the same result${failure}, and ${rejected}. Use the retained evidence and make a different validated tool call with changed input before you retry it.`;
}

export function duplicatePromptView(
  messages: ChatMessage[],
  state: DuplicateRecoveryState,
): ChatMessage[] {
  if (state.activeBlockedSignature === undefined && state.omittedCallIds.size === 0)
    return messages;
  const cleaned = cleanedDuplicateHistory(messages, state);
  if (state.activeBlockedSignature === undefined) return cleaned;
  cleaned.push({ role: "system", text: recoveryInstruction(state, messages) });
  if (state.latestUserDirection !== undefined) {
    cleaned.push({
      role: "user",
      text: `Latest user direction for repeated-action recovery:\n${state.latestUserDirection}`,
    });
  }
  return cleaned;
}

function liveCallIds(messages: readonly ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls) ids.add(call.id);
    }
    if (message.role === "tool") ids.add(message.toolCallId);
  }
  return ids;
}

export function pruneOmittedDuplicateCalls(
  state: DuplicateRecoveryState,
  messages: readonly ChatMessage[],
): void {
  const live = liveCallIds(messages);
  for (const callId of state.omittedCallIds) {
    if (!live.has(callId)) state.omittedCallIds.delete(callId);
  }
}

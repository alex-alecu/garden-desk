import type { AgentRunSnapshot } from "@vault/shared";
import type { DesktopState } from "./state.js";
import { eventItems } from "./timeline.js";

function runTimeline(state: DesktopState, snapshot: AgentRunSnapshot, working: boolean) {
  const responseId = `streaming-response-${snapshot.run.id}`;
  const unchanged = state.timeline.filter(
    (item) =>
      item.id !== responseId && (item.kind !== "activity" || item.runId !== snapshot.run.id),
  );
  const events = eventItems(snapshot.events);
  const response = snapshot.run.response;
  const hasPersistedResponse =
    !working &&
    unchanged.some((item) => item.kind === "assistant" && item.runId === snapshot.run.id);
  if (response === null || response.length === 0 || hasPersistedResponse) {
    return [...unchanged, ...events];
  }
  return [
    ...unchanged,
    ...events,
    {
      createdAt: events.at(-1)?.createdAt ?? snapshot.run.updatedAt,
      id: responseId,
      kind: "assistant" as const,
      text: response,
      runId: snapshot.run.id,
      streaming: working,
    },
  ];
}

export function applyAgentSnapshot(state: DesktopState, snapshot: AgentRunSnapshot): DesktopState {
  const working = snapshot.run.state === "queued" || snapshot.run.state === "running";
  const workingSessionIds = working
    ? [...new Set([...state.workingSessionIds, snapshot.run.sessionId])]
    : state.workingSessionIds.filter((id) => id !== snapshot.run.sessionId);
  const thinkingBySession = retainThinking(state, snapshot);
  if (snapshot.run.sessionId !== state.activeSessionId) {
    return { ...state, workingSessionIds, thinkingBySession };
  }
  const knownArtifacts = new Set(state.artifacts.map((item) => item.id));
  const otherExecutions = state.executions.filter((item) => item.runId !== snapshot.run.id);
  return {
    ...state,
    workingSessionIds,
    activeRun: snapshot.run,
    thinking: snapshot.thinking,
    thinkingBySession,
    question: working ? snapshot.question : null,
    contextUsedTokens: snapshot.contextUsedTokens ?? state.contextUsedTokens,
    contextAllocatedTokens: snapshot.contextAllocatedTokens ?? state.contextAllocatedTokens,
    artifacts: [
      ...state.artifacts,
      ...snapshot.artifacts.filter((item) => !knownArtifacts.has(item.id)),
    ],
    executions: [...otherExecutions, ...snapshot.executions],
    timeline: runTimeline(state, snapshot, working),
  };
}

function retainThinking(
  state: DesktopState,
  snapshot: AgentRunSnapshot,
): DesktopState["thinkingBySession"] {
  if (snapshot.thinking === null || snapshot.thinking.length === 0) return state.thinkingBySession;
  const stepId = snapshot.events.findLast((event) => event.type === "inference.started")?.id;
  if (stepId === undefined) return state.thinkingBySession;
  const sessionThinking = state.thinkingBySession[snapshot.run.sessionId] ?? {};
  if (sessionThinking[stepId] === snapshot.thinking) return state.thinkingBySession;
  return {
    ...state.thinkingBySession,
    [snapshot.run.sessionId]: { ...sessionThinking, [stepId]: snapshot.thinking },
  };
}

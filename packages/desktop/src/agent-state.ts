import type { AgentRunSnapshot } from "@vault/shared";
import type { DesktopState } from "./state.js";
import { eventItems } from "./timeline.js";

export function applyAgentSnapshot(state: DesktopState, snapshot: AgentRunSnapshot): DesktopState {
  const working = snapshot.run.state === "queued" || snapshot.run.state === "running";
  const workingSessionIds = working
    ? [...new Set([...state.workingSessionIds, snapshot.run.sessionId])]
    : state.workingSessionIds.filter((id) => id !== snapshot.run.sessionId);
  if (snapshot.run.sessionId !== state.activeSessionId) return { ...state, workingSessionIds };
  const knownArtifacts = new Set(state.artifacts.map((item) => item.id));
  const otherTimeline = state.timeline.filter(
    (item) => item.kind !== "activity" || item.runId !== snapshot.run.id,
  );
  const otherExecutions = state.executions.filter((item) => item.runId !== snapshot.run.id);
  return {
    ...state,
    workingSessionIds,
    activeRun: snapshot.run,
    thinking: snapshot.thinking,
    question: working ? snapshot.question : null,
    contextUsedTokens: snapshot.contextUsedTokens ?? state.contextUsedTokens,
    contextAllocatedTokens: snapshot.contextAllocatedTokens ?? state.contextAllocatedTokens,
    artifacts: [
      ...state.artifacts,
      ...snapshot.artifacts.filter((item) => !knownArtifacts.has(item.id)),
    ],
    executions: [...otherExecutions, ...snapshot.executions],
    timeline: [...otherTimeline, ...eventItems(snapshot.events)],
  };
}

import type { AgentRunSnapshot } from "@vault/shared";
import type { DesktopState } from "./state.js";
import { eventItem } from "./timeline.js";

export function applyAgentSnapshot(state: DesktopState, snapshot: AgentRunSnapshot): DesktopState {
  const working = snapshot.run.state === "queued" || snapshot.run.state === "running";
  const workingSessionIds = working
    ? [...new Set([...state.workingSessionIds, snapshot.run.sessionId])]
    : state.workingSessionIds.filter((id) => id !== snapshot.run.sessionId);
  if (snapshot.run.sessionId !== state.activeSessionId) return { ...state, workingSessionIds };
  const known = new Set(state.timeline.map((item) => item.id));
  const knownArtifacts = new Set(state.artifacts.map((item) => item.id));
  const activity = snapshot.events.filter((item) => !known.has(item.id)).map(eventItem);
  const otherExecutions = state.executions.filter((item) => item.runId !== snapshot.run.id);
  return {
    ...state,
    workingSessionIds,
    activeRun: snapshot.run,
    thinking: snapshot.thinking,
    artifacts: [
      ...state.artifacts,
      ...snapshot.artifacts.filter((item) => !knownArtifacts.has(item.id)),
    ],
    executions: [...otherExecutions, ...snapshot.executions],
    timeline: [...state.timeline, ...activity],
  };
}

import type { AgentRunSummary } from "@gardendesk/shared";
import { useEffect, useState } from "react";
import { applyAgentSnapshot } from "./agent-state.js";
import type { DesktopApi } from "./api.js";
import { retryLocalRequest } from "./run-polling.js";
import { type DesktopAction, desktopReducer, initialDesktopState } from "./state.js";

export function useChildRun(api: DesktopApi, run: AgentRunSummary | undefined) {
  const [state, setState] = useState(initialDesktopState);
  const [unavailable, setUnavailable] = useState(false);
  const runId = run?.id;
  useEffect(() => {
    setState(initialDesktopState);
    setUnavailable(false);
    if (runId === undefined) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const snapshot = await retryLocalRequest(() => api.getAgentRun(runId)).catch(() => undefined);
      if (!active) return;
      setUnavailable(snapshot === undefined);
      if (snapshot !== undefined) {
        setState((current) =>
          applyAgentSnapshot({ ...current, activeSessionId: snapshot.run.sessionId }, snapshot),
        );
        if (!["queued", "running"].includes(snapshot.run.state)) return;
      }
      timer = setTimeout(() => void refresh(), 350);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, runId]);
  return {
    state: state.activeRun?.id === runId ? state : initialDesktopState,
    unavailable,
    dispatch: (action: DesktopAction) => setState((current) => desktopReducer(current, action)),
  };
}

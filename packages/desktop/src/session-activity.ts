import type { AgentRunSnapshot, AgentRunSummary } from "@vault/shared";
import type { DesktopApi } from "./api.js";

interface SessionActivity {
  incomplete: boolean;
  snapshots: AgentRunSnapshot[];
}

export async function loadSessionActivity(
  api: DesktopApi,
  sessionId: string,
): Promise<SessionActivity> {
  let runs: AgentRunSummary[];
  try {
    runs = await api.listAgentRuns(sessionId);
  } catch {
    return { incomplete: true, snapshots: [] };
  }
  const results = await Promise.allSettled(runs.map((run) => api.getAgentRun(run.id)));
  return {
    incomplete: results.some((result) => result.status === "rejected"),
    snapshots: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  };
}

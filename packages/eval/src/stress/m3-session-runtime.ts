import { request } from "@vault/cli/client";
import {
  type AgentRunSnapshot,
  AgentRunSummarySchema,
  type AgentTrace,
  AgentTraceSchema,
  SessionSummarySchema,
} from "@vault/shared";
import { pollStressRun } from "./m3-stress-run-polling.js";

let rpcId = 50_000;

async function rpc(endpoint: string, method: string, params: Record<string, unknown>) {
  const response = await request(endpoint, { id: ++rpcId, method, params });
  if ("error" in response) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.result;
}

export async function createStressSession(endpoint: string): Promise<string> {
  return SessionSummarySchema.parse(await rpc(endpoint, "sessions.create", { folderId: null })).id;
}

async function startRun(endpoint: string, sessionId: string, task: string, deadline: number) {
  while (performance.now() < deadline) {
    try {
      return AgentRunSummarySchema.parse(await rpc(endpoint, "agent.start", { sessionId, task }));
    } catch (error) {
      const message = String(error);
      if (
        !message.includes("agent_busy") &&
        !message.includes("internal: The request could not be completed.")
      )
        throw error;
      await new Promise((accept) => setTimeout(accept, 1_000));
    }
  }
  throw new Error("Stress session remained busy after its previous terminal run.");
}

export async function runStressSessionTurn(
  endpoint: string,
  sessionId: string,
  task: string,
  deadlineMs: number,
): Promise<{ snapshot: AgentRunSnapshot; trace: AgentTrace }> {
  const deadline = performance.now() + deadlineMs;
  const run = await startRun(endpoint, sessionId, task, deadline);
  while (performance.now() < deadline) {
    const snapshot = await pollStressRun(endpoint, run.id, rpc);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") {
      return {
        snapshot,
        trace: AgentTraceSchema.parse(await rpc(endpoint, "agent.trace", { runId: run.id })),
      };
    }
    await new Promise((accept) => setTimeout(accept, 1_000));
  }
  throw new Error(
    `Stress session turn timed out after ${Math.round(deadlineMs / 60_000)} minutes.`,
  );
}

export async function deleteStressSession(endpoint: string, sessionId: string): Promise<void> {
  const deadline = performance.now() + 5 * 60_000;
  while (performance.now() < deadline) {
    try {
      await rpc(endpoint, "sessions.delete", { sessionId });
      return;
    } catch (error) {
      if (!String(error).includes("agent_busy")) throw error;
      await new Promise((accept) => setTimeout(accept, 1_000));
    }
  }
  throw new Error("Stress session remained busy during cleanup.");
}

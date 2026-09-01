import type { createGardenDeskCore } from "@gardendesk/core";
import type { AgentRunSnapshot } from "@gardendesk/shared";

export class M3ProductCheckFailure extends Error {
  override readonly name = "M3ProductCheckFailure";
}

export function requireM3ProductCheck(condition: boolean, message: string): asserts condition {
  if (!condition) throw new M3ProductCheckFailure(message);
}

/** Reads a run snapshot and dismisses a pending question so headless runs never wait for a person. */
export async function pollAgentRun(
  core: Awaited<ReturnType<typeof createGardenDeskCore>>,
  runId: string,
): Promise<AgentRunSnapshot> {
  const snapshot = await core.getAgentRun(runId);
  if (snapshot.question !== null) await core.dismissQuestion(runId, snapshot.question.id);
  return snapshot;
}

import { type AgentRunSnapshot, AgentRunSnapshotSchema } from "@vault/shared";

type StressRpc = (
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export async function pollStressRun(
  endpoint: string,
  runId: string,
  rpc: StressRpc,
): Promise<AgentRunSnapshot> {
  const snapshot = AgentRunSnapshotSchema.parse(await rpc(endpoint, "agent.get", { runId }));
  if (snapshot.question !== null) {
    await rpc(endpoint, "agent.dismissQuestion", { runId, questionId: snapshot.question.id });
  }
  return snapshot;
}

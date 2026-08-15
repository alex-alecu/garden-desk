import type { createVaultCore } from "@vault/core";
import type { AgentRunSnapshot } from "@vault/shared";

type Core = Awaited<ReturnType<typeof createVaultCore>>;

async function awaitRun(core: Core, runId: string): Promise<AgentRunSnapshot> {
  const deadline = performance.now() + 10 * 60_000;
  while (performance.now() < deadline) {
    const snapshot = await core.getAgentRun(runId);
    if (snapshot.run.state !== "queued" && snapshot.run.state !== "running") return snapshot;
    await new Promise((accept) => setTimeout(accept, 500));
  }
  throw new Error("Real image agent run timed out.");
}

export async function realImageEvidence(
  core: Core,
  imagePath: string,
): Promise<Record<string, unknown>> {
  const session = await core.createSession(null);
  await core.addAttachment(session.id, imagePath);
  const run = await core.startAgent(
    session.id,
    "Describe the attached image in one short sentence. Use the image tool directly in this run.",
  );
  const snapshot = await awaitRun(core, run.id);
  const imageCalls = snapshot.events.filter(
    (event) => event.type === "tool.completed" && event.toolName === "image",
  );
  if (
    snapshot.run.state !== "succeeded" ||
    imageCalls.length !== 1 ||
    !snapshot.run.response?.toLowerCase().includes("camera")
  ) {
    throw new Error(`Real image agent proof failed: ${JSON.stringify(snapshot)}`);
  }
  await core.deleteSession(session.id);
  return { imageCalls: imageCalls.length, response: snapshot.run.response };
}

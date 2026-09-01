import { AgentArtifactIdSchema, type RpcRequest, SessionIdSchema } from "@gardendesk/shared";
import type { GardenDeskCore } from "../facade.js";

function artifactParameters(request: RpcRequest): { artifactId: string; sessionId: string } {
  const sessionId = SessionIdSchema.safeParse(request.params.sessionId);
  if (!sessionId.success) throw new Error("invalid_session_id");
  const artifactId = AgentArtifactIdSchema.safeParse(request.params.artifactId);
  if (!artifactId.success) throw new Error("invalid_artifact_id");
  return { artifactId: artifactId.data, sessionId: sessionId.data };
}

export async function dispatchArtifactMethod(core: GardenDeskCore, request: RpcRequest) {
  const { artifactId, sessionId } = artifactParameters(request);
  if (request.method === "artifacts.materialize") {
    return await core.materializeArtifact(sessionId, artifactId);
  }
  if (request.method === "artifacts.recordOpen") {
    const { outcome } = request.params;
    if (outcome !== "failed" && outcome !== "succeeded") throw new Error("invalid_open_outcome");
    await core.recordArtifactOpen(sessionId, artifactId, outcome);
    return { recorded: true };
  }
  const { destination } = request.params;
  if (typeof destination !== "string") throw new Error("invalid_export_destination");
  await core.exportArtifact(sessionId, artifactId, destination);
  return { exported: true };
}

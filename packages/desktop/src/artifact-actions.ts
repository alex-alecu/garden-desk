import type { AgentArtifactSummary } from "@vault/shared";
import type { DesktopApi } from "./api.js";

type SetError = (message: string | undefined) => void;
export type ArtifactSaveResult = "cancelled" | "failed" | "saved";

export async function openArtifact(
  api: DesktopApi,
  sessionId: string,
  artifactId: string,
  setError: SetError,
): Promise<void> {
  setError(undefined);
  try {
    await api.openArtifact(sessionId, artifactId);
  } catch {
    setError("This generated file could not be opened. You can still use Save As…");
  }
}

interface SaveArtifactOptions {
  api: DesktopApi;
  artifactId: string;
  name: string;
  sessionId: string;
  setError: SetError;
}

export async function saveArtifact(options: SaveArtifactOptions): Promise<ArtifactSaveResult> {
  options.setError(undefined);
  try {
    return (await options.api.saveArtifact(options.sessionId, options.artifactId, options.name))
      ? "saved"
      : "cancelled";
  } catch {
    options.setError("This generated file could not be saved.");
    return "failed";
  }
}

export function artifactActions(
  api: DesktopApi,
  sessionId: string | undefined,
  setError: SetError,
) {
  return {
    async onOpenArtifact(artifact: AgentArtifactSummary) {
      if (sessionId !== undefined) await openArtifact(api, sessionId, artifact.id, setError);
    },
    async onSaveArtifact(artifact: AgentArtifactSummary) {
      if (sessionId === undefined) return "failed";
      return await saveArtifact({
        api,
        artifactId: artifact.id,
        name: artifact.name,
        sessionId,
        setError,
      });
    },
  };
}

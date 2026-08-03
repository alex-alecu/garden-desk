import type { SecureWorkspaceStatus } from "../api.js";
import { secureWorkspaceMessage } from "../secure-workspace.js";

export function SecureWorkspaceBanner({
  busy,
  onSetup,
  status,
}: {
  busy: boolean;
  onSetup(): void;
  status: SecureWorkspaceStatus | undefined;
}) {
  if (status === undefined || status.state === "ready") return null;
  return (
    <section className="secure-workspace-banner" role="status">
      <span>{secureWorkspaceMessage(status)}</span>
      {status.state === "permission_required" ? (
        <button disabled={busy} onClick={onSetup} type="button">
          {busy ? "Setting up…" : "Set up"}
        </button>
      ) : null}
    </section>
  );
}

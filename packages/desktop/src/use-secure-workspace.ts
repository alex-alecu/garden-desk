import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopApi, SecureWorkspaceStatus } from "./api.js";
import type { ConfirmationRequest } from "./components/confirmation.js";
import { secureWorkspaceSetupDescription } from "./secure-workspace.js";

export function useSecureWorkspace(
  api: DesktopApi,
  setConfirmation: (request: ConfirmationRequest | undefined) => void,
  setError: (message: string) => void,
) {
  const [status, setStatus] = useState<SecureWorkspaceStatus>();
  const [busy, setBusy] = useState(false);
  const prompted = useRef(false);

  const configure = useCallback(() => {
    setBusy(true);
    void api
      .configureSecureWorkspace()
      .then((result) => setStatus(result.status))
      .catch(() => setError("Windows could not configure the secure workspace."))
      .finally(() => setBusy(false));
  }, [api, setError]);

  const showSetup = useCallback(() => {
    setConfirmation({
      cancelLabel: "Use limited mode",
      confirmLabel: "Set up",
      description: secureWorkspaceSetupDescription,
      intent: "primary",
      onConfirm: configure,
      title: "Set up secure workspace?",
    });
  }, [configure, setConfirmation]);

  useEffect(() => {
    void api
      .getSecureWorkspaceStatus()
      .then(setStatus)
      .catch(() => setError("The secure workspace status could not be read."));
  }, [api, setError]);

  useEffect(() => {
    if (status?.state === "permission_required" && !prompted.current) {
      prompted.current = true;
      showSetup();
    }
  }, [showSetup, status?.state]);

  return { busy, showSetup, status };
}

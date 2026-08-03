import type { SecureWorkspaceState, SecureWorkspaceStatus } from "./api.js";

export const secureWorkspaceSetupDescription =
  "Vault Desk uses Windows Hyper-V to run tools in an offline virtual machine. Setup grants this Windows account full Hyper-V management access so Vault Desk can run without administrator prompts. Windows will ask for administrator approval once, and you will need to sign out afterward.";

const messages: Record<Exclude<SecureWorkspaceState, "ready">, string> = {
  permission_required:
    "Secure workspace is not configured. You can review existing work, but new tasks are disabled.",
  sign_out_required:
    "Setup is complete. Sign out of Windows and sign back in to enable secure workspace.",
  unavailable:
    "Windows Hyper-V is unavailable. Enable Hyper-V on a supported Windows edition before setting up Vault Desk.",
};

export function secureWorkspaceMessage(status: SecureWorkspaceStatus): string | undefined {
  return status.state === "ready" ? undefined : messages[status.state];
}

export function secureWorkspaceAllowsTasks(status: SecureWorkspaceStatus | undefined): boolean {
  return status?.state === "ready";
}

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SecureWorkspaceBanner } from "./components/secure-workspace-banner.js";
import {
  secureWorkspaceAllowsTasks,
  secureWorkspaceMessage,
  secureWorkspaceSetupDescription,
} from "./secure-workspace.js";

describe("secure workspace setup", () => {
  it("allows tasks only after the current token has Hyper-V access", () => {
    expect(secureWorkspaceAllowsTasks({ state: "ready" })).toBe(true);
    expect(secureWorkspaceAllowsTasks({ state: "permission_required" })).toBe(false);
    expect(secureWorkspaceAllowsTasks({ state: "sign_out_required" })).toBe(false);
    expect(secureWorkspaceAllowsTasks({ state: "unavailable" })).toBe(false);
    expect(secureWorkspaceAllowsTasks(undefined)).toBe(false);
  });

  it("discloses the standing Windows permission before setup", () => {
    expect(secureWorkspaceSetupDescription).toContain("full Hyper-V management access");
    expect(secureWorkspaceSetupDescription).toContain("sign out");
  });

  it("offers retry only while permission is missing", () => {
    const required = renderToStaticMarkup(
      <SecureWorkspaceBanner
        busy={false}
        onSetup={() => undefined}
        status={{ state: "permission_required" }}
      />,
    );
    const pending = renderToStaticMarkup(
      <SecureWorkspaceBanner
        busy={false}
        onSetup={() => undefined}
        status={{ state: "sign_out_required" }}
      />,
    );
    expect(required).toContain("new tasks are disabled");
    expect(required).toContain(">Set up</button>");
    expect(pending).toContain("Sign out of Windows");
    expect(pending).not.toContain("<button");
    expect(secureWorkspaceMessage({ state: "ready" })).toBeUndefined();
  });
});

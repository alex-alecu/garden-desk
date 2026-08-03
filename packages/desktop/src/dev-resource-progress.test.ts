import { describe, expect, it } from "vitest";
import { developmentResourceStageMessage } from "./dev-resource-progress.js";

describe("desktop development resource progress", () => {
  it("explains long-running offline startup stages", () => {
    expect(developmentResourceStageMessage("model")).toBe(
      "[Vault Desk startup] Copying and hashing the 6.5 GiB local model...",
    );
    expect(developmentResourceStageMessage("manifest")).toBe(
      "[Vault Desk startup] Hashing and recording the complete offline resource package...",
    );
    expect(developmentResourceStageMessage("windowsPermissionSetup")).toBe(
      "[Vault Desk startup] Building the one-time Windows permission helper...",
    );
  });
});

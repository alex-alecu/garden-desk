import { describe, expect, it } from "vitest";
import { developmentResourceStageMessage } from "./dev-resource-progress.js";

describe("desktop development resource progress", () => {
  it("explains long-running offline startup stages", () => {
    expect(developmentResourceStageMessage("model")).toBe(
      "[Garden Desk startup] Verifying the local generation model and image projector for packaging...",
    );
    expect(developmentResourceStageMessage("visionRuntime")).toBe(
      "[Garden Desk startup] Copying the local image inspection runtime...",
    );
    expect(developmentResourceStageMessage("manifest")).toBe(
      "[Garden Desk startup] Hashing and recording the complete offline resource package...",
    );
    expect(developmentResourceStageMessage("windowsPermissionSetup")).toBe(
      "[Garden Desk startup] Building the one-time Windows permission helper...",
    );
  });
});

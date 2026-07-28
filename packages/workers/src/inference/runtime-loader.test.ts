import { describe, expect, it } from "vitest";
import { windowsGpuOrder } from "./runtime-loader.js";

describe("Windows inference runtime selection", () => {
  it("prefers packaged NVIDIA CUDA and falls back to AMD-compatible Vulkan", () => {
    expect(windowsGpuOrder).toEqual(["cuda", "vulkan"]);
  });
});

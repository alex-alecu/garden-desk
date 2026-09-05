import { describe, expect, it } from "vitest";
import { nativeRuntimePackages } from "./runtime-package-contract.js";

describe("M3 Windows package contract", () => {
  it("ships CUDA and Vulkan packages together", () => {
    expect(nativeRuntimePackages("win32", "x64")).toEqual([
      "windows-cuda-x64",
      "windows-vulkan-x64",
    ]);
  });

  it("preserves the certified Apple silicon Metal package", () => {
    expect(nativeRuntimePackages("darwin", "arm64")).toEqual(["macos-arm64"]);
  });
});

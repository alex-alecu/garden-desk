import { describe, expect, it } from "vitest";
import { nativeRuntimePackages } from "./runtime-package-contract.js";

describe("M3 Windows package contract", () => {
  it("ships CUDA and Vulkan packages together", () => {
    expect(nativeRuntimePackages("win32", "x64")).toEqual([
      "@node-llama-cpp/win-x64-cuda",
      "@node-llama-cpp/win-x64-cuda-ext",
      "@node-llama-cpp/win-x64-vulkan",
    ]);
  });

  it("preserves the certified Apple silicon Metal package", () => {
    expect(nativeRuntimePackages("darwin", "arm64")).toEqual(["@node-llama-cpp/mac-arm64-metal"]);
  });
});

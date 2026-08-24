import type { LlamaLogLevel } from "node-llama-cpp";
import { afterEach, describe, expect, it } from "vitest";
import { llamaRuntimeLogOptions, windowsGpuOrder } from "./runtime-loader.js";

const logLevels = {
  debug: "debug" as LlamaLogLevel,
  error: "error" as LlamaLogLevel,
};

const originalDevelopmentBuild = globalThis.__VAULT_DEVELOPMENT_BUILD__;

afterEach(() => {
  globalThis.__VAULT_DEVELOPMENT_BUILD__ = originalDevelopmentBuild;
});

describe("Windows inference runtime selection", () => {
  it("prefers packaged NVIDIA CUDA and falls back to AMD-compatible Vulkan", () => {
    expect(windowsGpuOrder).toEqual(["cuda", "vulkan"]);
  });

  it("uses the raw library logger only from a development artifact", () => {
    globalThis.__VAULT_DEVELOPMENT_BUILD__ = true;
    expect(llamaRuntimeLogOptions(logLevels)).toMatchObject({
      logLevel: "debug",
      logger: expect.any(Function),
    });

    globalThis.__VAULT_DEVELOPMENT_BUILD__ = false;
    expect(llamaRuntimeLogOptions(logLevels)).toEqual({ logLevel: "error" });
  });
});

import { describe, expect, it } from "vitest";
import { windowsNativeWorkerArguments } from "./windows.js";

describe("Windows native worker launch arguments", () => {
  it("uses the dedicated packaged Node runtime", () => {
    const arguments_ = windowsNativeWorkerArguments(
      {
        workerEntryPath: "worker.mjs",
        memoryBudgetBytes: 12,
      },
      "scratch",
      "/packaged/node",
    );

    expect(arguments_.slice(0, 4)).toEqual(["run", "--executable", "/packaged/node", "--worker"]);
    expect(arguments_).not.toContain("--development-allow-shared-gpu");
    expect(arguments_).not.toContain("--development-vulkan-driver-filter");
  });

  it("adds the shared-memory exception only for an explicit development probe", () => {
    const arguments_ = windowsNativeWorkerArguments(
      { workerEntryPath: "worker.mjs", memoryBudgetBytes: 12 },
      "scratch",
      "/packaged/node",
      { developmentAllowSharedGpu: true },
    );

    expect(arguments_).toContain("--development-allow-shared-gpu");
    expect(arguments_).toContain("--development-vulkan-driver-filter");
    expect(arguments_).toContain("*amd*");
  });
});

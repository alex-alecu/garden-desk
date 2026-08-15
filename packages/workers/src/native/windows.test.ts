import { describe, expect, it } from "vitest";
import { windowsHelperEnvironment, windowsNativeWorkerArguments } from "./windows.js";

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
    expect(arguments_).not.toContain("--gpu-backend");
  });

  it("adds one validated GPU selection and memory profile", () => {
    const arguments_ = windowsNativeWorkerArguments(
      { workerEntryPath: "worker.mjs", memoryBudgetBytes: 12 },
      "scratch",
      "/packaged/node",
      {
        gpu: {
          backend: "vulkan",
          deviceIndex: 2,
          expectedName: "Integrated Graphics",
          memoryKind: "unified",
          detectedMemoryBytes: 16,
          installedMemoryBytes: 32,
        },
      },
    );

    expect(arguments_).toEqual(
      expect.arrayContaining([
        "--gpu-backend",
        "vulkan",
        "--gpu-device-index",
        "2",
        "--expected-gpu-name",
        "Integrated Graphics",
        "--gpu-memory-kind",
        "unified",
      ]),
    );
  });

  it.each([-1, 1.5, 0x1_0000_0000])("rejects the numeric GPU selector %s", (deviceIndex) => {
    expect(() =>
      windowsNativeWorkerArguments(
        { workerEntryPath: "worker.mjs", memoryBudgetBytes: 12 },
        "scratch",
        "/packaged/node",
        { gpu: { backend: "vulkan", deviceIndex } },
      ),
    ).toThrow("invalid_windows_gpu_selection");
  });

  it("does not pass credentials or network configuration to the helper", () => {
    expect(windowsHelperEnvironment()).toEqual({
      PATH: expect.any(String),
      SystemRoot: expect.any(String),
      WINDIR: expect.any(String),
    });
  });
});

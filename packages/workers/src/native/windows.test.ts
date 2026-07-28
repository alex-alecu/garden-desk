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
  });
});

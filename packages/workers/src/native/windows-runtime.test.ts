import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertVisionSelection: vi.fn(),
  inspect: vi.fn(),
  launcherArguments: [] as unknown[][],
  resolveProfile: vi.fn(),
  visionArguments: [] as unknown[][],
}));

vi.mock("./windows-gpu.js", () => ({
  assertWindowsVisionSelection: mocks.assertVisionSelection,
  resolveWindowsGpuProfile: mocks.resolveProfile,
}));

vi.mock("./windows.js", () => ({
  WindowsNativeWorkerLauncher: class {
    constructor(...arguments_: unknown[]) {
      mocks.launcherArguments.push(arguments_);
    }
  },
  windowsNativeWorkerEntryPath: () => "default-worker.mjs",
}));

vi.mock("../vision/client.js", () => ({
  LlamaVisionClient: class {
    constructor(...arguments_: unknown[]) {
      mocks.visionArguments.push(arguments_);
    }

    async inspect(input: unknown) {
      return await mocks.inspect(input);
    }
  },
}));

import { createWindowsInferenceRuntime } from "./windows-runtime.js";

const profile = {
  memoryBudgetBytes: 12,
  hostMemoryReservationBytes: 12,
  selection: {
    backend: "cuda" as const,
    deviceIndex: 1,
    detectedMemoryBytes: 24,
    expectedName: "Selected GPU",
    installedMemoryBytes: 32,
    memoryKind: "dedicated" as const,
  },
  visionSelection: { deviceIndex: 2, expectedName: "Selected GPU" },
};

const execution = {
  imagePath: "image.png",
  memoryBudgetBytes: 12,
  modelPath: "model.gguf",
  projectorPath: "projector.gguf",
  prompt: "Inspect the image.",
  timeoutMs: 1_000,
};

describe("Windows inference runtime composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.launcherArguments.length = 0;
    mocks.visionArguments.length = 0;
    mocks.resolveProfile.mockResolvedValue(profile);
    mocks.inspect.mockResolvedValue({ text: "ready" });
  });

  it("uses one selected profile for generation, vision, and neutral Core memory", async () => {
    const runtime = await createWindowsInferenceRuntime({
      inferenceHelperPath: "helper.exe",
      inferenceRuntimePath: "node.exe",
      visionRuntimePath: "vision.exe",
      workerEntryPath: "worker.mjs",
    });

    expect(runtime.hardwareProfile).toEqual({
      memoryBudgetBytes: 12,
      hostMemoryReservationBytes: 12,
    });
    expect(runtime.hardwareProfile).not.toHaveProperty("backend");
    expect(runtime.hardwareProfile).not.toHaveProperty("deviceIndex");
    expect(mocks.launcherArguments).toEqual([
      ["helper.exe", "node.exe", { gpu: profile.selection }],
    ]);
    expect(mocks.visionArguments).toEqual([["vision.exe", "helper.exe", 2]]);

    await expect(runtime.visionClient?.inspect(execution)).resolves.toEqual({ text: "ready" });
    expect(mocks.assertVisionSelection).toHaveBeenCalledWith(
      { helperPath: "helper.exe", runtimePath: "node.exe", workerEntryPath: "worker.mjs" },
      profile,
    );
    expect(mocks.assertVisionSelection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.inspect.mock.invocationCallOrder[0] as number,
    );
  });
});

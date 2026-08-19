import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node-llama-cpp", () => ({
  Gemma4ChatWrapper: class {},
  LlamaChat: class {},
  LlamaChatSession: class {
    resetChatHistory() {}
  },
}));

import type { LoadedRuntime } from "./worker-runtime.js";
import { generationSession } from "./worker-runtime.js";

const GiB = 1024 ** 3;

interface FakeRuntimeInput {
  budget: number;
  contextEstimateBytes: number;
  detectedGpuMemoryBytes: number;
  gpuMemoryKind: "dedicated" | "unified";
  installedMemoryBytes: number;
  measuredGpuBytes?: number;
}

function fakeRuntime(input: FakeRuntimeInput) {
  const createContext = vi.fn(async ({ contextSize }: { contextSize: number }) => ({
    contextSize,
    getSequence: () => ({}),
    dispose: vi.fn(async () => {}),
  }));
  const runtime = {
    budget: input.budget,
    backend: input.gpuMemoryKind === "unified" ? "vulkan" : "cuda",
    detectedGpuMemoryBytes: input.detectedGpuMemoryBytes,
    gpuMemoryKind: input.gpuMemoryKind,
    installedMemoryBytes: input.installedMemoryBytes,
    selectedDeviceCount: 1,
    llama: {
      getLlamaMemoryUsage: async () => ({
        cpuRam: 0,
        gpuVram: input.measuredGpuBytes ?? 1 * GiB,
      }),
    },
    model: {
      gpuLayers: 1,
      defaultContextFlashAttention: false,
      defaultContextSwaFullCache: false,
      useMmap: true,
      createContext,
      fileInsights: {
        estimateContextResourceRequirementsV2: async () => ({
          cpuRam: 0,
          gpuVram: input.contextEstimateBytes,
        }),
      },
    },
  } as unknown as LoadedRuntime;
  return { runtime, createContext };
}

const request = { contextSize: "auto", modelId: "test-model" } as never;

const platform = process.platform;

function usePlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

afterEach(() => usePlatform(platform));

describe("Windows generation context fitting", () => {
  it("fits a unified profile against the combined budget", async () => {
    usePlatform("win32");
    const { runtime, createContext } = fakeRuntime({
      budget: 12 * GiB,
      contextEstimateBytes: 1 * GiB,
      detectedGpuMemoryBytes: 16 * GiB,
      gpuMemoryKind: "unified",
      installedMemoryBytes: 32 * GiB,
    });

    const session = await generationSession(request, runtime);

    expect(createContext).toHaveBeenCalled();
    expect(session.contextSize).toBeGreaterThanOrEqual(8_192);
    expect(session.contextLimitTokens).toBe(65_536);
    expect(session.contextLimitReason).toBe("unified_memory_at_most_32_gib");
  });

  it("rejects a unified profile whose measured allocation exceeds the budget", async () => {
    usePlatform("win32");
    const { runtime } = fakeRuntime({
      budget: 8 * GiB,
      contextEstimateBytes: 1 * GiB,
      detectedGpuMemoryBytes: 16 * GiB,
      gpuMemoryKind: "unified",
      installedMemoryBytes: 32 * GiB,
      measuredGpuBytes: 9 * GiB,
    });

    await expect(generationSession(request, runtime)).rejects.toThrow(
      "combined_memory_budget_exceeded",
    );
  });

  it("uses device memory rather than combined fitting for a dedicated profile", async () => {
    usePlatform("win32");
    const { runtime, createContext } = fakeRuntime({
      budget: 16 * GiB,
      contextEstimateBytes: 1 * GiB,
      detectedGpuMemoryBytes: 16 * GiB,
      gpuMemoryKind: "dedicated",
      installedMemoryBytes: 32 * GiB,
      measuredGpuBytes: 15 * GiB,
    });

    const session = await generationSession(request, runtime);

    expect(createContext).toHaveBeenCalledWith({
      contextSize: { min: 8_192, max: 65_536 },
      sequences: 1,
    });
    expect(session.contextLimitReason).toBe("dedicated_memory_at_most_24_gib");
  });
});

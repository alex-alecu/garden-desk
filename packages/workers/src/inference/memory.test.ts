import { describe, expect, it } from "vitest";
import {
  combinedAllocationBytes,
  fitCombinedGenerationContext,
  resolveDetectedGpuVramBytes,
  resolveDevelopmentWindowsSharedGpuBudget,
  resolveGenerationContextLimit,
  resolveGenerationContextSize,
  resolveMaximumGenerationContext,
  resolveRuntimeMemoryBudget,
  resolveSequenceCount,
} from "./memory.js";

const GiB = 1024 * 1024 * 1024;
const contextCaps = [
  {
    platform: "darwin",
    memory: 24,
    vram: 48,
    maximum: 65_536,
    reason: "mac_unified_memory_at_most_32_gib",
  },
  {
    platform: "darwin",
    memory: 32,
    vram: 48,
    maximum: 65_536,
    reason: "mac_unified_memory_at_most_32_gib",
  },
  {
    platform: "darwin",
    memory: 48,
    vram: 16,
    maximum: 131_072,
    reason: "mac_unified_memory_above_32_gib",
  },
  {
    platform: "win32",
    memory: 128,
    vram: 24,
    maximum: 65_536,
    reason: "windows_gpu_vram_at_most_24_gib",
  },
  {
    platform: "win32",
    memory: 16,
    vram: 32,
    maximum: 131_072,
    reason: "windows_gpu_vram_above_24_gib",
  },
] as const;

describe("inference memory budget", () => {
  it("uses one Windows device's dedicated VRAM", () => {
    expect(resolveDetectedGpuVramBytes("win32", { total: 16 * GiB, unifiedSize: 0 }, 1)).toBe(
      16 * GiB,
    );
  });

  it("rejects Windows multi-device aggregates and unified memory", () => {
    expect(() =>
      resolveDetectedGpuVramBytes("win32", { total: 32 * GiB, unifiedSize: 0 }, 2),
    ).toThrow("dedicated_gpu_vram_required");
    expect(() =>
      resolveDetectedGpuVramBytes("win32", { total: 16 * GiB, unifiedSize: 8 * GiB }, 1),
    ).toThrow("dedicated_gpu_vram_required");
  });

  it("preserves unified memory reporting outside Windows", () => {
    expect(
      resolveDetectedGpuVramBytes("darwin", { total: 48 * GiB, unifiedSize: 48 * GiB }, 1),
    ).toBe(48 * GiB);
  });

  it("uses the full detected Windows GPU VRAM for generation", () => {
    expect(resolveRuntimeMemoryBudget(64 * GiB, 16 * GiB, "win32", "generate")).toBe(16 * GiB);
  });

  it("rejects Windows generation without detected GPU VRAM", () => {
    expect(() => resolveRuntimeMemoryBudget(16 * GiB, 0, "win32", "generate")).toThrow(
      "supported_gpu_required",
    );
  });

  it("preserves Mac budgets and bounded embedding reservations", () => {
    expect(resolveRuntimeMemoryBudget(12 * GiB, 48 * GiB, "darwin", "generate")).toBe(12 * GiB);
    expect(resolveRuntimeMemoryBudget(2 * GiB, 16 * GiB, "win32", "embed")).toBe(2 * GiB);
  });
});

describe("development shared GPU probe", () => {
  it("allows one shared-memory Windows GPU with a bounded budget", () => {
    expect(
      resolveDetectedGpuVramBytes("win32", { total: 32 * GiB, unifiedSize: 32 * GiB }, 1, true),
    ).toBe(32 * GiB);
    expect(resolveDevelopmentWindowsSharedGpuBudget(12 * GiB, 32 * GiB)).toBe(12 * GiB);
  });

  it("rejects multiple Windows GPUs", () => {
    expect(() =>
      resolveDetectedGpuVramBytes("win32", { total: 32 * GiB, unifiedSize: 16 * GiB }, 2, true),
    ).toThrow("dedicated_gpu_vram_required");
  });
});

describe("generation context caps", () => {
  it.each(contextCaps)(
    "caps $platform generation with $memory GiB memory and $vram GiB VRAM at $maximum tokens",
    ({ platform, memory, vram, maximum, reason }) => {
      expect(resolveMaximumGenerationContext(platform, memory * GiB, vram * GiB)).toBe(maximum);
      expect(resolveGenerationContextLimit(platform, memory * GiB, vram * GiB)).toEqual({
        maximumContextTokens: maximum,
        reason,
      });
    },
  );

  it("uses strict high-memory thresholds", () => {
    expect(resolveMaximumGenerationContext("darwin", 32 * GiB + 1, 0)).toBe(131_072);
    expect(resolveMaximumGenerationContext("win32", 0, 24 * GiB + 1)).toBe(131_072);
  });

  it("fits automatic and explicit generation context inside the hardware cap", () => {
    expect(resolveGenerationContextSize("auto", 65_536)).toEqual({
      min: 8_192,
      max: 65_536,
    });
    expect(resolveGenerationContextSize(32_768, 65_536)).toBe(32_768);
    expect(() => resolveGenerationContextSize(131_072, 65_536)).toThrow(
      "context_size_exceeds_hardware_cap",
    );
  });
});

describe("combined generation allocation", () => {
  it("selects the largest aligned context inside a combined memory budget", async () => {
    const selected = await fitCombinedGenerationContext(
      100,
      { cpuRamBytes: 20, gpuVramBytes: 30 },
      131_072,
      async (contextSize) => ({ cpuRamBytes: 0, gpuVramBytes: contextSize / 819.2 }),
    );
    expect(selected).toBe(40_960);
  });

  it("rejects a Mac budget that cannot fit the minimum context", async () => {
    await expect(
      fitCombinedGenerationContext(50, { cpuRamBytes: 20, gpuVramBytes: 30 }, 65_536, async () => ({
        cpuRamBytes: 1,
        gpuVramBytes: 0,
      })),
    ).rejects.toThrow("combined_memory_budget_exceeded");
  });

  it("does not fit beyond the platform context cap when memory is available", async () => {
    await expect(
      fitCombinedGenerationContext(
        1_000,
        { cpuRamBytes: 20, gpuVramBytes: 30 },
        65_536,
        async () => ({ cpuRamBytes: 1, gpuVramBytes: 1 }),
      ),
    ).resolves.toBe(65_536);
  });

  it("reports the combined CPU and GPU allocation", () => {
    expect(combinedAllocationBytes({ cpuRamBytes: 3, gpuVramBytes: 5 })).toBe(8);
  });
});

describe("parallel sequence count", () => {
  it("stays single when the budget has no headroom for another sequence", () => {
    // Model 8 GiB + one 2 GiB context = 10 GiB fills a 10 GiB budget exactly.
    expect(resolveSequenceCount(10 * GiB, 8 * GiB, 2 * GiB)).toBe(1);
  });

  it("adds sequences while each extra context fits, capped at two extra", () => {
    // 6 GiB model + 1 GiB per sequence in a 16 GiB budget leaves room for many, but the cap holds.
    expect(resolveSequenceCount(16 * GiB, 6 * GiB, 1 * GiB)).toBe(3);
  });

  it("adds exactly one extra sequence when only one more context fits", () => {
    // 8 GiB model + 2 GiB per sequence in 12 GiB budget: primary + one extra = 12 GiB.
    expect(resolveSequenceCount(12 * GiB, 8 * GiB, 2 * GiB)).toBe(2);
  });

  it("degrades to a single sequence for a non-positive per-sequence cost", () => {
    expect(resolveSequenceCount(16 * GiB, 6 * GiB, 0)).toBe(1);
  });
});

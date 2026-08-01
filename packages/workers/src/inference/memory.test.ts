import { describe, expect, it } from "vitest";
import {
  combinedAllocationBytes,
  fitCombinedGenerationContext,
  resolveGenerationContextSize,
  resolveMaximumGenerationContext,
  resolveRuntimeMemoryBudget,
} from "./memory.js";

const GiB = 1024 * 1024 * 1024;

describe("inference memory budget", () => {
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

describe("generation context caps", () => {
  it.each([
    ["darwin", 24, 48, 65_536],
    ["darwin", 32, 48, 65_536],
    ["darwin", 48, 16, 131_072],
    ["win32", 128, 24, 65_536],
    ["win32", 16, 32, 131_072],
  ] as const)(
    "caps %s generation with %d GiB memory and %d GiB VRAM at %d tokens",
    (platform, memory, vram, maximum) => {
      expect(resolveMaximumGenerationContext(platform, memory * GiB, vram * GiB)).toBe(maximum);
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

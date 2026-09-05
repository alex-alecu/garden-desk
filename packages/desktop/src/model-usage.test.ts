import type { ModelRuntimeStatus } from "@gardendesk/shared";
import { describe, expect, it } from "vitest";
import { contextMeter, gpuMemoryUsage } from "./model-usage.js";

const GiB = 1024 ** 3;
const ready: ModelRuntimeStatus = {
  modelId: "gemma-4-12b-it-qat-q4_0",
  name: "Gemma 4 12B QAT",
  state: "ready",
  thinkingSupported: true,
  memoryBudgetBytes: 16 * GiB,
  cpuRamBytes: 1 * GiB,
  gpuMemoryBytes: 11.5 * GiB,
  gpuMemoryKind: "unified",
  contextSizeTokens: 8_192,
};

describe("gpuMemoryUsage", () => {
  it("retains the known budget when allocation measurements are missing", () => {
    const { cpuRamBytes: _cpu, gpuMemoryBytes: _gpu, ...model } = ready;
    expect(gpuMemoryUsage(model)).toMatchObject({
      used: undefined,
      budget: "16.0 GiB",
      label: "Unified GPU memory",
    });
  });

  it("collapses to a single model-plus-context value against the budget", () => {
    expect(gpuMemoryUsage(ready)).toEqual({
      used: "12.5 GiB",
      budget: "16.0 GiB",
      label: "Unified GPU memory",
      sequences: undefined,
    });
  });

  it("reports the sequence count when the runtime allocated more than one", () => {
    expect(gpuMemoryUsage({ ...ready, sequenceCount: 2 })?.sequences).toBe(2);
  });

  it("shows only the GPU allocation for dedicated memory", () => {
    expect(gpuMemoryUsage({ ...ready, gpuMemoryKind: "dedicated" })).toMatchObject({
      used: "11.5 GiB",
      label: "VRAM",
    });
  });

  it("is unavailable when the model is not resident", () => {
    expect(gpuMemoryUsage({ ...ready, state: "unloaded" })).toBeUndefined();
  });
});

describe("contextMeter", () => {
  it("reports used, allocated, and percent from live tokens", () => {
    expect(contextMeter(4_096, 8_192, ready)).toEqual({
      used: 4_096,
      allocated: 8_192,
      percent: 50,
      warning: false,
    });
  });

  it("warns at or above the compaction threshold", () => {
    expect(contextMeter(6_600, 8_192, ready)?.warning).toBe(true);
  });

  it("falls back to the model's allocated context when the run has none", () => {
    expect(contextMeter(2_048, null, ready)?.allocated).toBe(8_192);
  });

  it("is unavailable without a used value", () => {
    expect(contextMeter(null, 8_192, ready)).toBeUndefined();
  });
});

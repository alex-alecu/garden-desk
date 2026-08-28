import { describe, expect, it } from "vitest";
import { resolveAgentSessionCapacity, resolveInferenceHardwarePolicy } from "./hardware.js";

const GiB = 1024 * 1024 * 1024;

describe("automatic inference hardware policy", () => {
  it.each([
    [48, 16],
    [32, 16],
    [24, 12],
    [18, 12],
    [16, 10],
  ])("uses a %d GiB Mac with a %d GiB model and context budget", (memory, budget) => {
    expect(resolveInferenceHardwarePolicy("auto", "darwin", memory * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: budget * GiB,
    });
  });

  it("rejects an 8 GiB Mac before inference starts", () => {
    expect(resolveInferenceHardwarePolicy("auto", "darwin", 8 * GiB)).toEqual({
      supported: false,
      message: "This Mac has 8 GB of memory. Garden Desk requires more memory to run locally.",
    });
  });

  it("uses system memory only as the Windows worker process bound", () => {
    expect(resolveInferenceHardwarePolicy("auto", "win32", 64 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 64 * GiB,
    });
  });

  it("preserves explicit certification budgets", () => {
    expect(resolveInferenceHardwarePolicy("local12", "darwin", 48 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 12 * GiB,
    });
    expect(resolveInferenceHardwarePolicy("local16", "win32", 64 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 16 * GiB,
    });
  });
});

describe("agent VM memory policy", () => {
  it.each([
    [16, 10, 1],
    [24, 12, 1],
    [32, 16, 2],
    [48, 16, 5],
  ])("allows %d GiB Macs %d GiB inference and %d agent VMs", (memory, inference, sessions) => {
    expect(resolveAgentSessionCapacity(inference * GiB, memory * GiB)).toBe(sessions);
  });

  it.each([
    [32, 5],
    [64, 12],
    [128, 25],
  ])("keeps discrete GPU VRAM outside the %d GiB Windows host RAM pool", (memory, sessions) => {
    expect(resolveAgentSessionCapacity(2 * GiB, memory * GiB)).toBe(sessions);
  });
});

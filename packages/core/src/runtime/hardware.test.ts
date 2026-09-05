import { describe, expect, it } from "vitest";
import { resolveAgentSessionCapacity, resolveInferenceHardwarePolicy } from "./hardware.js";

const GiB = 1024 * 1024 * 1024;

describe("automatic inference hardware policy", () => {
  it.each([
    [48, 16],
    [32, 16],
    [24, 16],
  ])("uses a %d GiB Mac with a %d GiB model and context budget", (memory, budget) => {
    expect(resolveInferenceHardwarePolicy("auto", "darwin", memory * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: budget * GiB,
    });
  });

  it("rejects an 8 GiB Mac before inference starts", () => {
    expect(resolveInferenceHardwarePolicy("auto", "darwin", 8 * GiB)).toEqual({
      supported: false,
      message: "Garden Desk requires a Mac with at least 24 GB of memory.",
    });
  });

  it("uses system memory only as the Windows worker process bound", () => {
    expect(resolveInferenceHardwarePolicy("auto", "win32", 64 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 16 * GiB,
    });
  });

  it("checks hardware before an explicit profile", () => {
    expect(resolveInferenceHardwarePolicy("local16", "darwin", 48 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 16 * GiB,
    });
    expect(resolveInferenceHardwarePolicy("local16", "darwin", 16 * GiB).supported).toBe(false);
    expect(resolveInferenceHardwarePolicy("local16", "win32", 64 * GiB)).toEqual({
      supported: true,
      memoryBudgetBytes: 16 * GiB,
    });
  });
});

describe("agent VM memory policy", () => {
  it.each([
    [16, 16, 0],
    [24, 16, 1],
    [32, 16, 3],
    [48, 16, 7],
  ])("allows %d GiB Macs %d GiB inference and %d agent VMs", (memory, inference, sessions) => {
    expect(resolveAgentSessionCapacity(inference * GiB, memory * GiB)).toBe(sessions);
  });

  it.each([
    [32, 3],
    [64, 11],
    [128, 27],
  ])("keeps discrete GPU VRAM outside the %d GiB Windows host RAM pool", (memory, sessions) => {
    expect(resolveAgentSessionCapacity(16 * GiB, memory * GiB)).toBe(sessions);
  });
});

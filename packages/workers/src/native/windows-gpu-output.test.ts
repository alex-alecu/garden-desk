import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { collectWindowsGpuProcess } from "./windows-gpu.js";
import {
  parseWindowsGpuInfo,
  parseWindowsRuntimeProbe,
} from "./windows-gpu-policy.js";

function adapter(description = "GPU") {
  return {
    id: "00000000:00000001",
    description,
    integrated: false,
    dedicatedAdapterMemoryBytes: 1,
    dedicatedSystemMemoryBytes: 0,
    sharedSystemMemoryBytes: 1,
  };
}

describe("Windows GPU helper output", () => {
  it("accepts the bounded fact schema", () => {
    expect(
      parseWindowsGpuInfo(
        JSON.stringify({ schemaVersion: 1, installedMemoryBytes: 1, adapters: [adapter()] }),
      ),
    ).toMatchObject({ installedMemoryBytes: 1, adapters: [{ description: "GPU" }] });
  });

  it("rejects oversized adapter data and runtime device sets", () => {
    expect(() =>
      parseWindowsGpuInfo(
        JSON.stringify({
          schemaVersion: 1,
          installedMemoryBytes: 1,
          adapters: [adapter("x".repeat(513))],
        }),
      ),
    ).toThrow("invalid_windows_gpu_info");
    expect(() =>
      parseWindowsRuntimeProbe(
        JSON.stringify({
          schemaVersion: 1,
          backend: "vulkan",
          deviceNames: Array.from({ length: 65 }, (_, index) => `GPU ${index}`),
          totalMemoryBytes: 1,
        }),
      ),
    ).toThrow("invalid_windows_runtime_probe");
  });

  it("does not treat an unknown probe schema as an unavailable backend", () => {
    expect(() =>
      parseWindowsRuntimeProbe(JSON.stringify({ schemaVersion: 2, available: false })),
    ).toThrow("invalid_windows_runtime_probe");
  });

  it("kills a helper that exceeds the stdout limit", async () => {
    const child = spawn(process.execPath, ["-e", 'process.stdout.write("x".repeat(65537))'], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await expect(collectWindowsGpuProcess(child, "test_gpu_info")).rejects.toThrow(
      "test_gpu_info_output_limit",
    );
  });
});

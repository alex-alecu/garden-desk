import { describe, expect, it } from "vitest";
import type { WindowsGpuLaunch } from "./windows.js";
import {
  normalizeGpuName,
  resolveIntegratedGpuBudget,
  resolveWindowsGpuProfileFromFacts,
  type WindowsGpuAdapterInfo,
  type WindowsGpuInfo,
  type WindowsRuntimeProbeResult,
} from "./windows-gpu-policy.js";

const GiB = 1024 ** 3;

function adapter(id: string, description: string, integrated: boolean): WindowsGpuAdapterInfo {
  return {
    id,
    description,
    integrated,
    dedicatedAdapterMemoryBytes: integrated ? 0 : 8 * GiB,
    dedicatedSystemMemoryBytes: 0,
    sharedSystemMemoryBytes: 16 * GiB,
  };
}

function inventory(
  backend: "cuda" | "vulkan",
  deviceNames: string[],
  totalMemoryBytes = 1,
): WindowsRuntimeProbeResult {
  return { schemaVersion: 1, backend, deviceNames, totalMemoryBytes };
}

function facts(adapters: WindowsGpuAdapterInfo[], installedMemoryBytes = 32 * GiB): WindowsGpuInfo {
  return { schemaVersion: 1, installedMemoryBytes, adapters };
}

function probe(
  values: Record<string, { name: string; memory: number } | "failed">,
): (selection: WindowsGpuLaunch) => Promise<WindowsRuntimeProbeResult | undefined> {
  return async (selection) => {
    const value = values[`${selection.backend}:${selection.deviceIndex}`];
    if (value === undefined || value === "failed") return undefined;
    return inventory(selection.backend, [value.name], value.memory);
  };
}

describe("Windows integrated GPU budgets", () => {
  it.each([
    [16 * GiB - 1, undefined],
    [16 * GiB, 8 * GiB],
    [16 * GiB + 1, 12 * GiB],
    [24 * GiB, 12 * GiB],
    [24 * GiB + 1, 16 * GiB],
  ])("maps %d installed bytes to the required budget", (installed, budget) => {
    expect(resolveIntegratedGpuBudget(installed)).toBe(budget);
  });
});

describe("Windows dedicated GPU preference", () => {
  it("selects an NVIDIA dedicated device through CUDA before an AMD integrated device", async () => {
    const selected = await resolveWindowsGpuProfileFromFacts(
      facts([
        adapter("nvidia", "NVIDIA GPU", false),
        adapter("amd", "AMD Integrated Graphics", true),
      ]),
      [
        inventory("cuda", ["NVIDIA GPU"]),
        inventory("vulkan", ["AMD Integrated Graphics", "NVIDIA GPU"]),
      ],
      probe({
        "cuda:0": { name: "NVIDIA GPU", memory: 12 * GiB },
        "vulkan:0": { name: "AMD Integrated Graphics", memory: 16 * GiB },
        "vulkan:1": { name: "NVIDIA GPU", memory: 12 * GiB },
      }),
    );
    expect(selected.selection).toMatchObject({
      backend: "cuda",
      deviceIndex: 0,
      expectedName: "NVIDIA GPU",
      memoryKind: "dedicated",
    });
    expect(selected.visionSelection).toEqual({ deviceIndex: 1, expectedName: "NVIDIA GPU" });
  });
});

describe("Windows GPU selection without vendor rules", () => {
  it("selects an Intel dedicated device before an Intel integrated device", async () => {
    const selected = await resolveWindowsGpuProfileFromFacts(
      facts([
        adapter("integrated", "Intel Integrated Graphics", true),
        adapter("dedicated", "Intel Arc Graphics", false),
      ]),
      [inventory("vulkan", ["Intel Integrated Graphics", "Intel Arc Graphics"])],
      probe({
        "vulkan:0": { name: "Intel Integrated Graphics", memory: 16 * GiB },
        "vulkan:1": { name: "Intel Arc Graphics", memory: 12 * GiB },
      }),
    );
    expect(selected.selection).toMatchObject({
      backend: "vulkan",
      expectedName: "Intel Arc Graphics",
      memoryKind: "dedicated",
    });
  });
});

describe("Windows integrated GPU fallback", () => {
  it.each(["AMD Integrated Graphics", "Intel Integrated Graphics", "NVIDIA Integrated Graphics"])(
    "uses the unified policy for %s without a vendor rule",
    async (name) => {
      const selected = await resolveWindowsGpuProfileFromFacts(
        facts([adapter("integrated", name, true)], 24 * GiB),
        [inventory("vulkan", [name])],
        probe({ "vulkan:0": { name, memory: 12 * GiB } }),
      );
      expect(selected).toMatchObject({
        memoryBudgetBytes: 12 * GiB,
        hostMemoryReservationBytes: 12 * GiB,
        selection: { expectedName: name, memoryKind: "unified" },
      });
    },
  );

  it("uses an integrated device when the dedicated device fails or is too small", async () => {
    const selected = await resolveWindowsGpuProfileFromFacts(
      facts([
        adapter("dedicated", "Dedicated GPU", false),
        adapter("integrated", "Integrated GPU", true),
      ]),
      [
        inventory("cuda", ["Dedicated GPU"]),
        inventory("vulkan", ["Dedicated GPU", "Integrated GPU"]),
      ],
      probe({
        "cuda:0": "failed",
        "vulkan:0": { name: "Dedicated GPU", memory: 8 * GiB - 1 },
        "vulkan:1": { name: "Integrated GPU", memory: 16 * GiB },
      }),
    );
    expect(selected.selection).toMatchObject({
      expectedName: "Integrated GPU",
      memoryKind: "unified",
    });
  });
});

describe("Windows GPU candidate ranking", () => {
  it("selects the dedicated device with the largest isolated memory", async () => {
    const selected = await resolveWindowsGpuProfileFromFacts(
      facts([adapter("large", "Large GPU", false), adapter("small", "Small GPU", false)]),
      [inventory("vulkan", ["Small GPU", "Large GPU"])],
      probe({
        "vulkan:0": { name: "Small GPU", memory: 12 * GiB },
        "vulkan:1": { name: "Large GPU", memory: 24 * GiB },
      }),
    );
    expect(selected.selection).toMatchObject({
      detectedMemoryBytes: 24 * GiB,
      expectedName: "Large GPU",
    });
  });

  it("uses CUDA before Vulkan for one mapped adapter", async () => {
    const selected = await resolveWindowsGpuProfileFromFacts(
      facts([adapter("gpu", "GPU", false)]),
      [inventory("cuda", ["GPU"]), inventory("vulkan", ["GPU"])],
      probe({
        "cuda:0": { name: "GPU", memory: 12 * GiB },
        "vulkan:0": { name: "GPU", memory: 12 * GiB },
      }),
    );
    expect(selected.selection.backend).toBe("cuda");
    expect(selected.visionSelection).toEqual({ deviceIndex: 0, expectedName: "GPU" });
  });
});

describe("Windows GPU identity failures", () => {
  it.each([
    {
      name: "missing mapping",
      adapters: [adapter("gpu", "Known GPU", false)],
      inventories: [inventory("vulkan", ["Unknown GPU"])],
      isolated: {},
    },
    {
      name: "ambiguous mapping",
      adapters: [adapter("a", "Same GPU", false), adapter("b", "Same GPU", false)],
      inventories: [inventory("vulkan", ["Same GPU"])],
      isolated: {},
    },
    {
      name: "changed topology",
      adapters: [adapter("gpu", "GPU A", false)],
      inventories: [inventory("vulkan", ["GPU A"])],
      isolated: { "vulkan:0": { name: "GPU B", memory: 12 * GiB } },
    },
    {
      name: "insufficient integrated capacity",
      adapters: [adapter("gpu", "Integrated GPU", true)],
      inventories: [inventory("vulkan", ["Integrated GPU"])],
      isolated: { "vulkan:0": { name: "Integrated GPU", memory: 16 * GiB - 1 } },
    },
  ])("returns unsupported for $name", async ({ adapters, inventories, isolated }) => {
    await expect(
      resolveWindowsGpuProfileFromFacts(facts(adapters), inventories, probe(isolated)),
    ).rejects.toThrow("supported_gpu_required");
  });

  it("returns unsupported when isolation still shows multiple devices", async () => {
    await expect(
      resolveWindowsGpuProfileFromFacts(
        facts([adapter("a", "GPU A", false), adapter("b", "GPU B", false)]),
        [inventory("vulkan", ["GPU A", "GPU B"])],
        async () => inventory("vulkan", ["GPU A", "GPU B"]),
      ),
    ).rejects.toThrow("supported_gpu_required");
  });

  it("normalizes device descriptions without a vendor rule", () => {
    expect(normalizeGpuName("Intel(R) Arc(TM) Graphics")).toBe(
      normalizeGpuName("intel arc graphics"),
    );
  });
});

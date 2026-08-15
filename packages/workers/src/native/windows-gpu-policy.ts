import type { WindowsGpuLaunch } from "./windows.js";

const GiB = 1024 ** 3;
const MAX_GPU_DEVICES = 64;
const DEDICATED_HOST_MEMORY_BYTES = 2 * GiB;

export interface WindowsGpuAdapterInfo {
  id: string;
  description: string;
  integrated: boolean;
  dedicatedAdapterMemoryBytes: number;
  dedicatedSystemMemoryBytes: number;
  sharedSystemMemoryBytes: number;
}

export interface WindowsGpuInfo {
  schemaVersion: 1;
  installedMemoryBytes: number;
  adapters: WindowsGpuAdapterInfo[];
}

export interface WindowsRuntimeProbeResult {
  schemaVersion: 1;
  backend: "cuda" | "vulkan";
  deviceNames: string[];
  totalMemoryBytes: number;
}

export interface WindowsGpuProfile {
  memoryBudgetBytes: number;
  hostMemoryReservationBytes: number;
  selection: Required<WindowsGpuLaunch>;
  visionSelection: { deviceIndex: number; expectedName: string };
}

interface Candidate {
  adapter: WindowsGpuAdapterInfo;
  cudaIndex?: number;
  vulkanIndex?: number;
}

interface IsolatedVariant {
  backend: "cuda" | "vulkan";
  deviceIndex: number;
  expectedName: string;
  totalMemoryBytes: number;
}

type Probe = (selection: WindowsGpuLaunch) => Promise<WindowsRuntimeProbeResult | undefined>;

function safeInteger(value: unknown, allowZero = true): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (allowZero ? value >= 0 : value > 0)
  );
}

export function parseWindowsGpuInfo(output: string): WindowsGpuInfo {
  const value = JSON.parse(output) as Partial<WindowsGpuInfo>;
  if (
    value.schemaVersion !== 1 ||
    !safeInteger(value.installedMemoryBytes, false) ||
    !Array.isArray(value.adapters) ||
    value.adapters.length > MAX_GPU_DEVICES
  ) {
    throw new Error("invalid_windows_gpu_info");
  }
  for (const adapter of value.adapters) validateAdapter(adapter);
  return value as WindowsGpuInfo;
}

function validateAdapter(value: unknown): asserts value is WindowsGpuAdapterInfo {
  const adapter = value as Partial<WindowsGpuAdapterInfo> | null;
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    typeof adapter.id !== "string" ||
    adapter.id.length === 0 ||
    adapter.id.length > 128 ||
    typeof adapter.description !== "string" ||
    adapter.description.length === 0 ||
    adapter.description.length > 512 ||
    typeof adapter.integrated !== "boolean" ||
    !safeInteger(adapter.dedicatedAdapterMemoryBytes) ||
    !safeInteger(adapter.dedicatedSystemMemoryBytes) ||
    !safeInteger(adapter.sharedSystemMemoryBytes)
  ) {
    throw new Error("invalid_windows_gpu_info");
  }
}

export function parseWindowsRuntimeProbe(output: string): WindowsRuntimeProbeResult | undefined {
  const value = JSON.parse(output) as Partial<WindowsRuntimeProbeResult> & { available?: boolean };
  if (value.schemaVersion !== 1) throw new Error("invalid_windows_runtime_probe");
  if (value.available === false) return undefined;
  if (
    (value.backend !== "cuda" && value.backend !== "vulkan") ||
    !Array.isArray(value.deviceNames) ||
    value.deviceNames.length === 0 ||
    value.deviceNames.length > MAX_GPU_DEVICES ||
    value.deviceNames.some(
      (name) => typeof name !== "string" || name.length === 0 || name.length > 512,
    ) ||
    !safeInteger(value.totalMemoryBytes, false)
  ) {
    throw new Error("invalid_windows_runtime_probe");
  }
  return value as WindowsRuntimeProbeResult;
}

export function normalizeGpuName(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/\((?:r|tm)\)/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

export function resolveIntegratedGpuBudget(installedMemoryBytes: number): number | undefined {
  if (installedMemoryBytes < 16 * GiB) return undefined;
  if (installedMemoryBytes === 16 * GiB) return 8 * GiB;
  if (installedMemoryBytes <= 24 * GiB) return 12 * GiB;
  return 16 * GiB;
}

export function resolveWindowsGpuMemoryProfile(
  integrated: boolean,
  detectedMemoryBytes: number,
  installedMemoryBytes: number,
): { hostMemoryReservationBytes: number; memoryBudgetBytes: number } | undefined {
  const memoryBudgetBytes = integrated
    ? resolveIntegratedGpuBudget(installedMemoryBytes)
    : detectedMemoryBytes >= 8 * GiB
      ? detectedMemoryBytes
      : undefined;
  if (memoryBudgetBytes === undefined || detectedMemoryBytes < memoryBudgetBytes) return undefined;
  return {
    memoryBudgetBytes,
    hostMemoryReservationBytes: integrated ? memoryBudgetBytes : DEDICATED_HOST_MEMORY_BYTES,
  };
}

export function mapRuntimeGpuName(
  adapters: WindowsGpuAdapterInfo[],
  runtimeName: string,
): WindowsGpuAdapterInfo {
  const normalized = normalizeGpuName(runtimeName);
  const matches = adapters.filter(
    (adapter) => normalizeGpuName(adapter.description) === normalized,
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error("ambiguous_windows_gpu_identity");
  }
  return matches[0];
}

export function isExpectedIsolatedGpu(
  adapterDescription: string,
  probe: Pick<WindowsRuntimeProbeResult, "deviceNames">,
): boolean {
  return (
    probe.deviceNames.length === 1 &&
    normalizeGpuName(probe.deviceNames[0] ?? "") === normalizeGpuName(adapterDescription)
  );
}

function mappedCandidates(
  adapters: WindowsGpuAdapterInfo[],
  inventories: WindowsRuntimeProbeResult[],
): Candidate[] {
  const candidates = new Map<string, Candidate>();
  for (const inventory of inventories) {
    for (const [index, name] of inventory.deviceNames.entries()) {
      const adapter = mapRuntimeGpuName(adapters, name);
      const candidate = candidates.get(adapter.id) ?? { adapter };
      const key = inventory.backend === "cuda" ? "cudaIndex" : "vulkanIndex";
      if (candidate[key] !== undefined) throw new Error("ambiguous_windows_gpu_identity");
      candidate[key] = index;
      candidates.set(adapter.id, candidate);
    }
  }
  return [...candidates.values()].toSorted((left, right) =>
    left.adapter.id.localeCompare(right.adapter.id),
  );
}

async function isolatedVariant(
  candidate: Candidate,
  backend: "cuda" | "vulkan",
  probe: Probe,
): Promise<IsolatedVariant | undefined> {
  const deviceIndex = backend === "cuda" ? candidate.cudaIndex : candidate.vulkanIndex;
  if (deviceIndex === undefined) return undefined;
  const result = await probe({ backend, deviceIndex }).catch(() => undefined);
  if (result === undefined) return undefined;
  if (result.backend !== backend || !isExpectedIsolatedGpu(candidate.adapter.description, result)) {
    throw new Error("changed_windows_gpu_topology");
  }
  return {
    backend,
    deviceIndex,
    expectedName: result.deviceNames[0] as string,
    totalMemoryBytes: result.totalMemoryBytes,
  };
}

async function resolveCandidate(
  candidate: Candidate,
  installedMemoryBytes: number,
  probe: Probe,
): Promise<WindowsGpuProfile | undefined> {
  const [cuda, vulkan] = await Promise.all([
    isolatedVariant(candidate, "cuda", probe),
    isolatedVariant(candidate, "vulkan", probe),
  ]);
  if (vulkan === undefined) return undefined;
  for (const generation of [cuda, vulkan]) {
    if (generation === undefined) continue;
    const memory = resolveWindowsGpuMemoryProfile(
      candidate.adapter.integrated,
      generation.totalMemoryBytes,
      installedMemoryBytes,
    );
    if (memory === undefined) continue;
    return {
      ...memory,
      selection: {
        backend: generation.backend,
        deviceIndex: generation.deviceIndex,
        detectedMemoryBytes: generation.totalMemoryBytes,
        expectedName: generation.expectedName,
        installedMemoryBytes,
        memoryKind: candidate.adapter.integrated ? "unified" : "dedicated",
      },
      visionSelection: {
        deviceIndex: vulkan.deviceIndex,
        expectedName: vulkan.expectedName,
      },
    };
  }
  return undefined;
}

export function selectPreferredWindowsGpuProfile(
  profiles: WindowsGpuProfile[],
): WindowsGpuProfile | undefined {
  return profiles.toSorted((left, right) => {
    if (left.selection.memoryKind !== right.selection.memoryKind) {
      return left.selection.memoryKind === "dedicated" ? -1 : 1;
    }
    const memory = right.selection.detectedMemoryBytes - left.selection.detectedMemoryBytes;
    if (memory !== 0) return memory;
    if (left.selection.backend !== right.selection.backend) {
      return left.selection.backend === "cuda" ? -1 : 1;
    }
    return left.selection.expectedName.localeCompare(right.selection.expectedName);
  })[0];
}

export async function resolveWindowsGpuProfileFromFacts(
  info: WindowsGpuInfo,
  inventories: WindowsRuntimeProbeResult[],
  probe: Probe,
): Promise<WindowsGpuProfile> {
  try {
    const profiles = await Promise.all(
      mappedCandidates(info.adapters, inventories).map(
        async (candidate) => await resolveCandidate(candidate, info.installedMemoryBytes, probe),
      ),
    );
    const selected = selectPreferredWindowsGpuProfile(
      profiles.filter((value): value is WindowsGpuProfile => value !== undefined),
    );
    if (selected !== undefined) return selected;
  } catch (error) {
    if (
      error instanceof Error &&
      ["ambiguous_windows_gpu_identity", "changed_windows_gpu_topology"].includes(error.message)
    ) {
      throw new Error("supported_gpu_required");
    }
    throw error;
  }
  throw new Error("supported_gpu_required");
}

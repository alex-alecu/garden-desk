import {
  mapRuntimeGpuName,
  type WindowsGpuInfo,
  type WindowsRuntimeProbeResult,
} from "./windows-gpu-policy.js";

export function isExpectedWindowsGpuIdentity(
  adapterId: string,
  selection: { backend: "cuda" | "vulkan"; expectedName: string },
  info: WindowsGpuInfo,
  result: WindowsRuntimeProbeResult | undefined,
): boolean {
  if (
    result === undefined ||
    result.backend !== selection.backend ||
    result.deviceNames.length !== 1
  ) {
    return false;
  }
  const deviceName = result.deviceNames[0];
  if (deviceName === undefined || deviceName !== selection.expectedName) return false;
  try {
    return mapRuntimeGpuName(info.adapters, deviceName).id === adapterId;
  } catch {
    return false;
  }
}

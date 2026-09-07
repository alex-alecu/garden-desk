export function nativeRuntimePackages(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string[] {
  if (platform === "darwin" && architecture === "arm64") {
    return ["macos-arm64"];
  }
  if (platform === "win32" && architecture === "x64") {
    return ["windows-cuda-x64", "windows-vulkan-x64"];
  }
  throw new Error("Unsupported Garden Desk inference runtime target.");
}

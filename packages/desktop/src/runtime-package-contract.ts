export function nativeRuntimePackages(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
): string[] {
  if (platform === "darwin" && architecture === "arm64") {
    return ["@node-llama-cpp/mac-arm64-metal"];
  }
  if (platform === "win32" && architecture === "x64") {
    return [
      "@node-llama-cpp/win-x64-cuda",
      "@node-llama-cpp/win-x64-cuda-ext",
      "@node-llama-cpp/win-x64-vulkan",
    ];
  }
  throw new Error("Unsupported Garden Desk inference runtime target.");
}

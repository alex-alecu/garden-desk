import { MacOsMicroVmLauncher, WindowsMicroVmLauncher } from "@gardendesk/workers";

export function createCodeAgentLauncher(
  helperPath: string,
  imageRoot: string | undefined,
  workspaceRoot: string,
) {
  return process.platform === "win32"
    ? new WindowsMicroVmLauncher(helperPath, imageRoot, workspaceRoot)
    : new MacOsMicroVmLauncher(helperPath, imageRoot, workspaceRoot);
}

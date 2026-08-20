import { type SpawnSyncReturns, spawnSync } from "node:child_process";

const ADMINISTRATOR_CHECK = [
  "$identity = [Security.Principal.WindowsIdentity]::GetCurrent();",
  "$principal = [Security.Principal.WindowsPrincipal]::new($identity);",
  "if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))",
  "{ exit 0 } else { exit 1 }",
].join(" ");

type Spawn = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => SpawnSyncReturns<Buffer>;

export function hasWindowsStandardUserAuthority(
  platform: NodeJS.Platform,
  spawn: Spawn = spawnSync,
): boolean {
  if (platform !== "win32") return true;
  const result = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", ADMINISTRATOR_CHECK],
    { stdio: "ignore" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error("Windows administrator status could not be determined.");
  }
  return result.status === 1;
}

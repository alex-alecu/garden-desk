// biome-ignore lint/style/noRestrictedImports: this native boundary launches the private socket relay and applies its directory access rules.
import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { Duplex } from "node:stream";
import { promisify } from "node:util";
import { windowsHelperEnvironment } from "./windows.js";

export async function protectSocketDirectory(path: string): Promise<void> {
  await promisify(execFile)(
    join(process.env.WINDIR ?? "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      '$ErrorActionPreference="Stop"; $p=$env:GARDEN_DESK_SOCKET_DIRECTORY; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=[Security.AccessControl.DirectorySecurity]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow")); [IO.Directory]::SetAccessControl($p,$acl); $actual=[IO.Directory]::GetAccessControl($p); if(-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw "private_directory_failed"}',
    ],
    {
      env: { ...windowsHelperEnvironment(), GARDEN_DESK_SOCKET_DIRECTORY: path },
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 16_384,
    },
  );
}

export function connectWindowsSocket(helper: string, socket: string): Duplex {
  const relay = spawn(helper, ["connect", "--socket", socket], {
    env: windowsHelperEnvironment(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stream = Duplex.from({ readable: relay.stdout, writable: relay.stdin });
  relay.stderr.resume();
  relay.once("error", () => stream.destroy(new Error("private_connection_failed")));
  relay.once("exit", (code) => {
    if (code !== 0) stream.destroy(new Error("private_connection_failed"));
  });
  stream.once("close", () => {
    if (relay.exitCode === null) relay.kill();
  });
  return stream;
}

// biome-ignore lint/style/noRestrictedImports: This helper checks private diagnostic permissions.
import { execFile } from "node:child_process";
// biome-ignore lint/style/noRestrictedImports: This helper reads private diagnostic permissions.
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

export async function assertPrivateDiagnosticTree(path: string): Promise<void> {
  if (process.platform !== "win32") {
    await assertUnixPrivateDiagnosticTree(path);
    return;
  }
  const script = `
$ErrorActionPreference = 'Stop'
$root = [Environment]::GetEnvironmentVariable('GARDEN_DESK_TEST_DIAGNOSTIC_PATH', 'Process')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach ($item in $items) {
  $acl = if ($item.PSIsContainer) { [IO.Directory]::GetAccessControl($item.FullName) } else { [IO.File]::GetAccessControl($item.FullName) }
  $rules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
  if (-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'diagnostic DACL verification failed' }
}
`;
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { env: { ...process.env, GARDEN_DESK_TEST_DIAGNOSTIC_PATH: path }, windowsHide: true },
      (error) => (error === null ? resolve() : reject(error)),
    );
  });
}

async function assertUnixPrivateDiagnosticTree(path: string): Promise<void> {
  const state = await lstat(path);
  expect(state.mode & 0o077).toBe(0);
  if (!state.isDirectory()) return;
  for (const name of await readdir(path)) await assertUnixPrivateDiagnosticTree(join(path, name));
}

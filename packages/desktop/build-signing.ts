import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { windowsSigningConfiguration } from "./src/windows-signing-mode.js";

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: "pipe" });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function windowsPowerShell(): { executable: string; modulePath: string } {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  const root = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0");
  return { executable: join(root, "powershell.exe"), modulePath: join(root, "Modules") };
}

export function stripWindowsSignature(executable: string): void {
  const programFiles = process.env["ProgramFiles(x86)"];
  if (programFiles === undefined) throw new Error("Missing 64-bit Windows SDK location.");
  const powerShell = windowsPowerShell();
  const script =
    '$s=Get-ChildItem "$env:VAULT_WINDOWS_KITS\\*\\x64\\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1;if($null -eq $s){exit 1};& $s.FullName remove /s $env:VAULT_SIGN_PATH;exit $LASTEXITCODE';
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    PSModulePath: powerShell.modulePath,
    VAULT_SIGN_PATH: executable,
    VAULT_WINDOWS_KITS: join(programFiles, "Windows Kits", "10", "bin"),
  });
}

function signWindowsDevelopment(executable: string): string {
  const powerShell = windowsPowerShell();
  const script =
    "$p=$env:VAULT_SIGN_PATH;$c=$null;try{$c=New-SelfSignedCertificate -Subject 'CN=Garden Desk M3 Development' -Type CodeSigningCert -CertStoreLocation Cert:\\CurrentUser\\My;Set-AuthenticodeSignature -FilePath $p -Certificate $c | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$ok=$null -ne $s.SignerCertificate -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned'}finally{if($null -ne $c){Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)}};if(-not $ok){exit 1}";
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    PSModulePath: powerShell.modulePath,
    VAULT_SIGN_PATH: executable,
  });
  return "windows-ephemeral-self-signed";
}

function signWindowsProduction(
  executable: string,
  certificateThumbprint: string,
  timestampUrl?: string,
): string {
  const powerShell = windowsPowerShell();
  const script =
    "$p=$env:VAULT_SIGN_PATH;$t=$env:VAULT_SIGN_THUMBPRINT;$c=Get-Item ('Cert:\\CurrentUser\\My\\'+$t) -ErrorAction Stop;if(-not $c.HasPrivateKey){exit 1};$a=@{FilePath=$p;Certificate=$c;HashAlgorithm='SHA256'};if(-not [string]::IsNullOrWhiteSpace($env:VAULT_SIGN_TIMESTAMP)){$a.TimestampServer=$env:VAULT_SIGN_TIMESTAMP};Set-AuthenticodeSignature @a | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$actual=$s.SignerCertificate.Thumbprint.Replace(' ','').ToUpperInvariant();$ok=$actual -eq $t -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned';if(-not $ok){exit 1}";
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    ...process.env,
    PSModulePath: powerShell.modulePath,
    VAULT_SIGN_PATH: executable,
    VAULT_SIGN_THUMBPRINT: certificateThumbprint,
    ...(timestampUrl === undefined ? {} : { VAULT_SIGN_TIMESTAMP: timestampUrl }),
  });
  return `windows-certificate-${certificateThumbprint}`;
}

function signWindows(executable: string): string {
  const configuration = windowsSigningConfiguration(process.env);
  return configuration.mode === "development"
    ? signWindowsDevelopment(executable)
    : signWindowsProduction(
        executable,
        configuration.certificateThumbprint,
        configuration.timestampUrl,
      );
}

export function signExecutable(executable: string): string {
  if (process.platform === "win32") return signWindows(executable);
  run("codesign", ["--force", "--sign", "-", executable]);
  run("codesign", ["--verify", "--strict", executable]);
  return "macos-adhoc";
}

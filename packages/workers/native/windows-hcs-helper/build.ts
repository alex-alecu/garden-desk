import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): void {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function windowsPowerShell(): { executable: string; modulePath: string } {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  const root = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0");
  return { executable: join(root, "powershell.exe"), modulePath: join(root, "Modules") };
}

function sign(executable: string): void {
  const powerShell = windowsPowerShell();
  const script =
    "$p=$env:GARDEN_DESK_SIGN_PATH;$c=$null;try{$c=New-SelfSignedCertificate -Subject 'CN=Garden Desk M1 HCS Helper' -Type CodeSigningCert -CertStoreLocation Cert:\\CurrentUser\\My;Set-AuthenticodeSignature -FilePath $p -Certificate $c | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$ok=$null -ne $s.SignerCertificate -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned'}finally{if($null -ne $c){Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)}};if(-not $ok){exit 1}";
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      PSModulePath: powerShell.modulePath,
      GARDEN_DESK_SIGN_PATH: executable,
    },
  });
}

if (process.platform === "win32") {
  const root = join(process.cwd(), "packages/workers/native/windows-hcs-helper");
  const generated = join(root, ".generated");
  const target = join(generated, "target");
  mkdirSync(generated, { recursive: true });
  run("cargo", ["build", "--release", "--locked", "--manifest-path", join(root, "Cargo.toml")], {
    env: { ...process.env, CARGO_TARGET_DIR: target },
  });
  const executable = join(generated, "garden-desk-hcs-helper.exe");
  copyFileSync(join(target, "release", "garden-desk-hcs-helper.exe"), executable);
  sign(executable);
} else {
  console.log("Windows HCS helper build is not required on this platform stage.");
}

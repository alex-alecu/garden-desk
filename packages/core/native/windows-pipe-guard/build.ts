import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: "pipe" });
  if (result.status === 0) return;
  const detail = result.error?.message ?? result.stderr ?? result.stdout ?? "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function sign(executable: string): void {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  const powerShellRoot = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0");
  const script =
    "$p=$env:VAULT_SIGN_PATH;$c=$null;try{$c=New-SelfSignedCertificate -Subject 'CN=Garden Desk M1 Pipe Guard' -Type CodeSigningCert -CertStoreLocation Cert:\\CurrentUser\\My;Set-AuthenticodeSignature -FilePath $p -Certificate $c | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$ok=$null -ne $s.SignerCertificate -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned'}finally{if($null -ne $c){Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)}};if(-not $ok){exit 1}";
  run(
    join(powerShellRoot, "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      ...process.env,
      PSModulePath: join(powerShellRoot, "Modules"),
      VAULT_SIGN_PATH: executable,
    },
  );
}

if (process.platform === "win32") {
  const root = join(process.cwd(), "packages/core/native/windows-pipe-guard");
  const generated = join(root, ".generated");
  const target = join(generated, "target");
  mkdirSync(generated, { recursive: true });
  run("cargo", ["build", "--release", "--locked", "--manifest-path", join(root, "Cargo.toml")], {
    ...process.env,
    CARGO_TARGET_DIR: target,
  });
  const executable = join(generated, "vault-pipe-guard.exe");
  copyFileSync(join(target, "release", "vault-pipe-guard.exe"), executable);
  sign(executable);
} else {
  console.log("Windows pipe guard build is not required on this platform stage.");
}

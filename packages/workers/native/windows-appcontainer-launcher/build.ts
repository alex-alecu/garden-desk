import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { encoding: "utf8", env, stdio: "pipe" });
  if (result.status === 0) return;
  const detail =
    result.error?.message ??
    [result.stderr, result.stdout].find((output) => output.trim() !== "") ??
    "unknown failure";
  throw new Error(`${command} failed: ${detail}`);
}

function sign(executable: string): void {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  const powerShellRoot = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0");
  const script =
    "$p=$env:GARDEN_DESK_SIGN_PATH;$c=$null;try{$c=New-SelfSignedCertificate -Subject 'CN=Garden Desk M2 AppContainer Launcher' -Type CodeSigningCert -CertStoreLocation Cert:\\CurrentUser\\My;Set-AuthenticodeSignature -FilePath $p -Certificate $c | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$ok=$null -ne $s.SignerCertificate -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned'}finally{if($null -ne $c){Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)}};if(-not $ok){exit 1}";
  run(
    join(powerShellRoot, "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      ...process.env,
      PSModulePath: join(powerShellRoot, "Modules"),
      GARDEN_DESK_SIGN_PATH: executable,
    },
  );
}

function hashDirectory(hash: ReturnType<typeof createHash>, root: string, directory: string): void {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) hashDirectory(hash, root, path);
    else {
      hash.update(path.slice(root.length));
      hash.update(readFileSync(path));
    }
  }
}

function dependencyFingerprint(root: string): string {
  const hash = createHash("sha256");
  const manifests = [
    "pnpm-lock.yaml",
    "packages/workers/package.json",
    "packages/shared/package.json",
  ];
  for (const path of manifests) hash.update(readFileSync(join(root, path)));
  hashDirectory(hash, root, join(root, "packages/workers/dist"));
  hashDirectory(hash, root, join(root, "packages/shared/dist"));
  return hash.digest("hex");
}

function deployRuntime(root: string): void {
  const runtime = join(root, "packages/workers/.generated/windows-runtime");
  const marker = join(runtime, ".garden-desk-dependencies");
  const fingerprint = dependencyFingerprint(root);
  const dependencyReady = existsSync(join(runtime, "node_modules/@gardendesk/shared"));
  if (!dependencyReady || !existsSync(marker) || readFileSync(marker, "utf8") !== fingerprint) {
    const pnpmCli = process.env.npm_execpath;
    if (pnpmCli === undefined) throw new Error("pnpm must invoke the Windows runtime build.");
    const workspaceStatePath = join(root, "node_modules/.pnpm-workspace-state-v1.json");
    const workspaceState = existsSync(workspaceStatePath)
      ? readFileSync(workspaceStatePath)
      : undefined;
    try {
      run(
        process.execPath,
        [
          pnpmCli,
          "--filter",
          "@gardendesk/workers",
          "deploy",
          "packages/workers/.generated/windows-runtime",
          "--prod",
          "--legacy",
          "--force",
          "--prefer-offline",
          "--config.node-linker=hoisted",
        ],
        { ...process.env, CI: "true" },
      );
    } finally {
      if (workspaceState !== undefined) writeFileSync(workspaceStatePath, workspaceState);
    }
  }
  writeFileSync(marker, fingerprint);
}

if (process.platform === "win32") {
  const workspaceRoot = process.cwd();
  const root = join(workspaceRoot, "packages/workers/native/windows-appcontainer-launcher");
  const generated = join(root, ".generated");
  const target = join(generated, "target");
  deployRuntime(workspaceRoot);
  mkdirSync(generated, { recursive: true });
  run("cargo", ["build", "--release", "--locked", "--manifest-path", join(root, "Cargo.toml")], {
    ...process.env,
    CARGO_TARGET_DIR: target,
  });
  const executable = join(generated, "garden-desk-appcontainer-launcher.exe");
  copyFileSync(join(target, "release", "garden-desk-appcontainer-launcher.exe"), executable);
  sign(executable);
} else {
  console.log("Windows AppContainer launcher build is not required on this platform stage.");
}

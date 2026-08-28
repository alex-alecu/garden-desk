import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const smokeRoot = fileURLToPath(new URL(".", import.meta.url));
const generatedRoot = join(smokeRoot, ".generated");
const frontendRoot = join(generatedRoot, "frontend");
const tauriRoot = join(smokeRoot, "src-tauri");
const expectedNodeVersion = "v24.18.0";

function windowsPowerShell(): { executable: string; modulePath: string } {
  const windowsRoot = process.env.WINDIR ?? "C:\\Windows";
  const root = join(windowsRoot, "System32", "WindowsPowerShell", "v1.0");
  return { executable: join(root, "powershell.exe"), modulePath: join(root, "Modules") };
}

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

function tryRun(command: string, args: string[]): void {
  spawnSync(command, args, { encoding: "utf8", stdio: "ignore" });
}

function stripWindowsSignature(executable: string): void {
  const programFiles = process.env["ProgramFiles(x86)"];
  if (programFiles === undefined) throw new Error("Missing 64-bit Windows SDK location.");
  const powerShell = windowsPowerShell();
  const script =
    '$s=Get-ChildItem "$env:VAULT_WINDOWS_KITS\\*\\x64\\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1;if($null -eq $s){exit 1};& $s.FullName remove /s $env:VAULT_SIGN_PATH;exit $LASTEXITCODE';
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      PSModulePath: powerShell.modulePath,
      VAULT_SIGN_PATH: executable,
      VAULT_WINDOWS_KITS: join(programFiles, "Windows Kits", "10", "bin"),
    },
  });
}

function targetTriple(): string {
  const key = `${process.platform}-${process.arch}`;
  const triples: Record<string, string> = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "win32-arm64": "aarch64-pc-windows-msvc",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  const triple = triples[key];
  if (triple === undefined) throw new Error(`Unsupported M0 Tauri target: ${key}`);
  return triple;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function buildFrontend(): Promise<void> {
  await mkdir(frontendRoot, { recursive: true });
  await copyFile(join(smokeRoot, "index.html"), join(frontendRoot, "index.html"));
  await build({
    entryPoints: [join(smokeRoot, "main.ts")],
    outfile: join(frontendRoot, "main.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
  });
}

async function prepareSea(): Promise<{
  executable: string;
  lockDigest: string;
  nodeExecutableDigest: string;
}> {
  if (process.version !== expectedNodeVersion) {
    throw new Error(`Expected Node ${expectedNodeVersion}, received ${process.version}.`);
  }
  const sidecarBundle = join(generatedRoot, "sidecar.cjs");
  const seaBlob = join(generatedRoot, "sidecar.blob");
  const executable = join(generatedRoot, process.platform === "win32" ? "sidecar.exe" : "sidecar");
  await build({
    entryPoints: [join(smokeRoot, "sidecar.ts")],
    outfile: sidecarBundle,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  await writeFile(
    join(generatedRoot, "sea-config.json"),
    `${JSON.stringify({ main: sidecarBundle, output: seaBlob, useCodeCache: false, useSnapshot: false })}\n`,
  );
  run(process.execPath, ["--experimental-sea-config", join(generatedRoot, "sea-config.json")]);
  await copyFile(process.execPath, executable);
  return {
    executable,
    lockDigest: await sha256(join(process.cwd(), "pnpm-lock.yaml")),
    nodeExecutableDigest: await sha256(process.execPath),
  };
}

function injectSea(executable: string): void {
  if (process.platform === "darwin") tryRun("codesign", ["--remove-signature", executable]);
  if (process.platform === "win32") stripWindowsSignature(executable);
  const postject = join(
    process.cwd(),
    "packages",
    "eval",
    "node_modules",
    "postject",
    "dist",
    "cli.js",
  );
  const args = [
    executable,
    "NODE_SEA_BLOB",
    join(generatedRoot, "sidecar.blob"),
    "--sentinel-fuse",
    "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  ];
  if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
  run(process.execPath, [postject, ...args]);
}

function signMac(executable: string): string {
  run("codesign", ["--force", "--sign", "-", executable]);
  run("codesign", ["--verify", "--strict", executable]);
  return "macos-adhoc";
}

function signWindows(executable: string): string {
  const powerShell = windowsPowerShell();
  const script =
    "$p=$env:VAULT_SIGN_PATH;$c=$null;try{$c=New-SelfSignedCertificate -Subject 'CN=Garden Desk M0 Smoke' -Type CodeSigningCert -CertStoreLocation Cert:\\CurrentUser\\My;Set-AuthenticodeSignature -FilePath $p -Certificate $c | Out-Null;$s=Get-AuthenticodeSignature -FilePath $p;$intact=$null -ne $s.SignerCertificate -and $s.Status -ne 'HashMismatch' -and $s.Status -ne 'NotSigned'}finally{if($null -ne $c){Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint)}};if(-not $intact){exit 1}";
  run(powerShell.executable, ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: {
      ...process.env,
      PSModulePath: powerShell.modulePath,
      VAULT_SIGN_PATH: executable,
    },
  });
  return "windows-ephemeral-self-signed";
}

function signExecutable(executable: string): string {
  if (process.platform === "darwin") return signMac(executable);
  if (process.platform === "win32") return signWindows(executable);
  throw new Error("M0 Tauri signing supports only macOS and Windows.");
}

async function installForTauri(executable: string): Promise<string> {
  const extension = process.platform === "win32" ? ".exe" : "";
  const destination = join(tauriRoot, "binaries", `vault-m0-sidecar-${targetTriple()}${extension}`);
  await mkdir(join(tauriRoot, "binaries"), { recursive: true });
  await copyFile(executable, destination);
  await chmod(destination, 0o755);
  return destination;
}

function runTauri(args: string[]): void {
  const cli = join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");
  run(process.execPath, [cli, ...args], { cwd: smokeRoot });
}

function buildTauriIcons(): void {
  runTauri(["icon", join(tauriRoot, "icons", "icon.svg"), "--output", join(tauriRoot, "icons")]);
}

function buildTauriShell(): void {
  runTauri(["build", "--no-bundle", "--debug", "--ci"]);
}

await rm(generatedRoot, { recursive: true, force: true });
await mkdir(generatedRoot, { recursive: true });
await buildFrontend();
const prepared = await prepareSea();
injectSea(prepared.executable);
await chmod(prepared.executable, 0o755);
const signingMode = signExecutable(prepared.executable);
const destination = await installForTauri(prepared.executable);
buildTauriIcons();
const record = {
  schemaVersion: 1,
  nodeVersion: process.version,
  nodeExecutableSha256: prepared.nodeExecutableDigest,
  targetTriple: targetTriple(),
  lockSha256: prepared.lockDigest,
  executableSha256: await sha256(destination),
  signingMode,
};
await writeFile(join(generatedRoot, "build-record.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record));
if (process.argv.includes("--tauri")) buildTauriShell();

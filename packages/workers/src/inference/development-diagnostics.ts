import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const MAX_WORKER_DIAGNOSTIC_BYTES = 1024 * 1024;
const MAX_WORKER_DIAGNOSTIC_RECORD_BYTES = 64 * 1024;
const MAX_DIAGNOSTIC_ERROR_NAME_CHARACTERS = 512;
const MAX_DIAGNOSTIC_MESSAGE_CHARACTERS = 4 * 1024;
const MAX_DIAGNOSTIC_STACK_CHARACTERS = 8 * 1024;
const MAX_DIAGNOSTIC_CAUSE_CHARACTERS = 4 * 1024;
const MAX_DIAGNOSTIC_CAUSE_PROPERTIES = 8;
const run = promisify(execFile);

const WINDOWS_PRIVATE_DIRECTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('GARDEN_DESK_DIAGNOSTIC_PATH', 'Process')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ([string]::IsNullOrEmpty($path) -or $null -eq $sid) { throw 'missing diagnostic identity' }
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
if (Test-Path -LiteralPath $path) {
  try { [IO.Directory]::SetAccessControl($path, $acl) } catch [UnauthorizedAccessException] { & icacls.exe $path /inheritance:r /grant:r "*$($sid.Value):(OI)(CI)F" | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'diagnostic directory ACL repair failed' } }
} else {
  [void][IO.Directory]::CreateDirectory($path, $acl)
}
$actual = [IO.Directory]::GetAccessControl($path)
$rules = @($actual.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'diagnostic directory DACL verification failed' }
`;

const WINDOWS_PRIVATE_FILE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = [Environment]::GetEnvironmentVariable('GARDEN_DESK_DIAGNOSTIC_PATH', 'Process')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ([string]::IsNullOrEmpty($path) -or $null -eq $sid -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'missing diagnostic file identity' }
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
[void]$acl.AddAccessRule($rule)
[IO.File]::SetAccessControl($path, $acl)
$actual = [IO.File]::GetAccessControl($path)
$rules = @($actual.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))
if (-not $actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value -or $rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { throw 'diagnostic file DACL verification failed' }
`;

declare global {
  var __GARDEN_DESK_DEVELOPMENT_BUILD__: boolean | undefined;
  var __GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__: string | undefined;
}

export interface DevelopmentDiagnosticSink {
  append(chunk: Buffer): void;
  close(): Promise<void>;
}

export type InferenceDiagnosticOperation = "chat" | "generate" | "embed";
export type InferenceDiagnosticOutput = "inference-host.log" | "worker-stderr.log";
export type InferenceDiagnosticHostStage = "model_prepare" | "worker_launch";

function boundedText(value: unknown, maximumCharacters: number): string {
  try {
    if (typeof value === "string") return value.slice(0, maximumCharacters);
    if (value === null || value === undefined) return String(value);
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint")
      return String(value).slice(0, maximumCharacters);
    return `[${typeof value}]`;
  } catch {
    return "[unavailable]";
  }
}

function errorCauseDetails(cause: Error): string {
  return boundedText(
    [
      `name=${boundedText(cause.name, MAX_DIAGNOSTIC_ERROR_NAME_CHARACTERS)}`,
      `message=${boundedText(cause.message, MAX_DIAGNOSTIC_MESSAGE_CHARACTERS)}`,
      `stack=${boundedText(cause.stack, MAX_DIAGNOSTIC_STACK_CHARACTERS)}`,
    ].join(" "),
    MAX_DIAGNOSTIC_CAUSE_CHARACTERS,
  );
}

function objectCauseDetails(cause: object): string {
  try {
    const properties: string[] = [];
    for (const name in cause) {
      if (!Object.hasOwn(cause, name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(cause, name);
      const value = descriptor?.get === undefined ? descriptor?.value : "[accessor]";
      properties.push(
        `${boundedText(name, MAX_DIAGNOSTIC_ERROR_NAME_CHARACTERS)}=${boundedText(
          value,
          MAX_DIAGNOSTIC_CAUSE_CHARACTERS,
        )}`,
      );
      if (properties.length === MAX_DIAGNOSTIC_CAUSE_PROPERTIES) break;
    }
    return boundedText(
      properties.length === 0 ? "[object]" : properties.join(" "),
      MAX_DIAGNOSTIC_CAUSE_CHARACTERS,
    );
  } catch {
    return "[unavailable]";
  }
}

function boundedCause(error: Error): string | undefined {
  const cause = error.cause;
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return errorCauseDetails(cause);
  if (typeof cause !== "object" || cause === null)
    return boundedText(cause, MAX_DIAGNOSTIC_CAUSE_CHARACTERS);
  return objectCauseDetails(cause);
}

function diagnosticErrorDetails(error: unknown): string {
  try {
    if (!(error instanceof Error))
      return `name=non_error\nmessage=${boundedText(error, MAX_DIAGNOSTIC_MESSAGE_CHARACTERS)}`;
    const lines = [
      `name=${boundedText(error.name, MAX_DIAGNOSTIC_ERROR_NAME_CHARACTERS)}`,
      `message=${boundedText(error.message, MAX_DIAGNOSTIC_MESSAGE_CHARACTERS)}`,
      `stack=${boundedText(error.stack, MAX_DIAGNOSTIC_STACK_CHARACTERS)}`,
    ];
    const cause = boundedCause(error);
    if (cause !== undefined) lines.push(`cause=${cause}`);
    return lines.join("\n");
  } catch {
    return "name=diagnostic_error\nmessage=[unavailable]\nstack=[unavailable]";
  }
}

function writeDiagnosticRecord(text: string): void {
  try {
    const record = Buffer.from(text, "utf8");
    process.stderr.write(record.subarray(0, MAX_WORKER_DIAGNOSTIC_RECORD_BYTES));
  } catch {
    // Diagnostics must not change the fixed worker response.
  }
}

function writeDiagnosticErrorRecord(prefix: string, error: unknown): void {
  try {
    writeDiagnosticRecord(`${prefix}\n${diagnosticErrorDetails(error)}\n`);
  } catch {
    // Diagnostics must not change the fixed worker response.
  }
}

export function writeDevelopmentWorkerFailure(error: unknown): void {
  if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ !== true) return;
  writeDiagnosticErrorRecord("[garden-desk-inference] worker failure", error);
}

export function writeDevelopmentWorkerStderrReady(): void {
  if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ !== true) return;
  writeDiagnosticRecord("[garden-desk-inference] worker-stderr-ready\n");
}

export function writeDevelopmentOperationFailure(
  operation: InferenceDiagnosticOperation,
  error: unknown,
): void {
  if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ !== true) return;
  writeDiagnosticErrorRecord(`[garden-desk-inference] operation=${operation} failed`, error);
}

export async function recordDevelopmentHostFailure(
  stage: InferenceDiagnosticHostStage,
  operation: InferenceDiagnosticOperation,
  error: unknown,
): Promise<void> {
  try {
    if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ !== true) return;
    const sink = createDevelopmentDiagnosticSink("inference-host.log");
    if (sink === undefined) return;
    sink.append(
      Buffer.from(
        `[garden-desk-inference] host stage=${stage} operation=${operation} failed\n${diagnosticErrorDetails(error)}\n`,
        "utf8",
      ).subarray(0, MAX_WORKER_DIAGNOSTIC_RECORD_BYTES),
    );
    await sink.close();
  } catch {
    // Diagnostics must not change inference behavior.
  }
}

async function secureWindowsPath(path: string, script: string): Promise<void> {
  await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, GARDEN_DESK_DIAGNOSTIC_PATH: path },
    windowsHide: true,
  });
}

async function makePrivateDiagnosticDirectory(path: string): Promise<void> {
  if (process.platform === "win32") {
    await secureWindowsPath(path, WINDOWS_PRIVATE_DIRECTORY_SCRIPT);
    return;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function makePrivateDiagnosticFile(path: string): Promise<void> {
  await writeFile(path, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  if (process.platform === "win32") {
    await secureWindowsPath(path, WINDOWS_PRIVATE_FILE_SCRIPT);
    return;
  }
  await chmod(path, 0o600);
}

async function preparePrivateDiagnosticOutput(
  root: string,
  directory: string,
  output: string,
): Promise<void> {
  await makePrivateDiagnosticDirectory(root);
  await makePrivateDiagnosticDirectory(directory);
  await makePrivateDiagnosticFile(output);
}

export function createDevelopmentDiagnosticSink(
  outputName: InferenceDiagnosticOutput = "worker-stderr.log",
): DevelopmentDiagnosticSink | undefined {
  if (globalThis.__GARDEN_DESK_DEVELOPMENT_BUILD__ !== true) return undefined;
  let root: string;
  let directory: string;
  let output: string;
  try {
    root = globalThis.__GARDEN_DESK_DEVELOPMENT_DIAGNOSTIC_ROOT__ ?? "";
    if (root === "") return undefined;
    directory = join(root, randomUUID());
    output = join(directory, outputName);
  } catch {
    return undefined;
  }
  let disabled = false;
  let written = 0;
  let pending = Promise.resolve();
  let prepared: Promise<void> | undefined;
  return {
    append(chunk) {
      try {
        if (disabled) return;
        const remaining = MAX_WORKER_DIAGNOSTIC_BYTES - written;
        if (remaining <= 0) return;
        const bounded = chunk.subarray(0, remaining);
        written += bounded.length;
        pending = pending.then(async () => {
          if (disabled) return;
          try {
            prepared ??= preparePrivateDiagnosticOutput(root, directory, output);
            await prepared;
            if (!disabled) await appendFile(output, bounded, { mode: 0o600 });
          } catch {
            disabled = true;
          }
        });
      } catch {
        disabled = true;
      }
    },
    async close() {
      try {
        await pending;
      } catch {
        // Diagnostics must not change worker disposal.
      }
    },
  };
}

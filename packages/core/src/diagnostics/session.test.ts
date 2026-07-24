import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { createSessionDebugSnapshot } from "./session.js";
import { createDebugFixture, type DebugFixture, IDS } from "./session-fixture.js";

const run = promisify(execFile);
const cleanup = new Set<string>();
let fixture: DebugFixture | undefined;

if (process.platform === "win32") vi.setConfig({ testTimeout: 30_000 });

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

async function assertPrivateTree(path: string): Promise<void> {
  if (process.platform === "win32") {
    await assertWindowsPrivateTree(path);
    return;
  }
  const state = await lstat(path);
  expect(state.mode & 0o077).toBe(0);
  if (!state.isDirectory()) return;
  for (const name of await readdir(path)) await assertPrivateTree(join(path, name));
}

async function assertWindowsPrivateTree(path: string): Promise<void> {
  const script = `
$ErrorActionPreference = 'Stop'
$root = [Environment]::GetEnvironmentVariable('VAULT_TEST_SNAPSHOT_PATH', 'Process')
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)
foreach ($item in $items) {
  if ($item.PSIsContainer) {
    $acl = [IO.Directory]::GetAccessControl($item.FullName)
  } else {
    $acl = [IO.File]::GetAccessControl($item.FullName)
  }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -eq 0 -or @($rules | Where-Object { $_.IdentityReference.Value -ne $sid }).Count -ne 0) { throw 'non-owner snapshot access rule' }
}
$rootAcl = [IO.Directory]::GetAccessControl($root)
if (-not $rootAcl.AreAccessRulesProtected) { throw 'snapshot root inherits access rules' }
`;
  await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, VAULT_TEST_SNAPSHOT_PATH: path },
    windowsHide: true,
  });
}

async function debugDirectories(): Promise<Set<string>> {
  return new Set(
    (await readdir(tmpdir())).filter((name) => name.startsWith("vault-session-debug-")),
  );
}

function artifactPath(root: string, hash: string): string {
  const digest = hash.slice("sha256:".length);
  return join(root, "artifacts", digest.slice(0, 2), digest);
}

async function newFixture(): Promise<DebugFixture> {
  fixture = await createDebugFixture();
  cleanup.add(fixture.root);
  return fixture;
}

async function workspaceFile(root: string, path: string): Promise<string> {
  const manifest = await json(join(root, "workspace", "manifest.json"));
  expect(manifest.version).toBe(1);
  const entries = manifest.entries as Array<Record<string, unknown>>;
  const entry = entries.find((item) => item.kind === "file" && item.path === path);
  expect(entry?.snapshotPath).toMatch(/^files\/[0-9]{8}$/u);
  return await readFile(join(root, "workspace", String(entry?.snapshotPath)), "utf8");
}

async function replaceWorkspace(
  state: DebugFixture,
  files: Array<{ path: string; value: string }>,
): Promise<void> {
  const root = join(state.internalRoot, "agent-workspaces");
  const entries = [];
  for (const file of files) {
    const bytes = Buffer.from(file.value);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const blobPath = join(root, "blobs", digest);
    await writeFile(blobPath, bytes, { mode: 0o600 });
    await chmod(blobPath, 0o600);
    entries.push({
      kind: "file",
      path: file.path,
      contentHash: digest,
      byteLength: bytes.byteLength,
    });
  }
  const manifestPath = join(root, "manifests", `${IDS.session}.json`);
  await writeFile(manifestPath, JSON.stringify({ version: 1, entries }), { mode: 0o600 });
  await chmod(manifestPath, 0o600);
}

async function assertSnapshotContent(root: string): Promise<void> {
  const session = await json(join(root, "session.json"));
  const conversation = await json(join(root, "conversation.json"));
  const currentTrace = await json(join(root, "logs", IDS.run, "trace.json"));
  const oldTrace = await json(join(root, "logs", IDS.oldRun, "trace.json"));
  const execution = await json(join(root, "logs", IDS.run, "executions", "0000.json"));
  expect((session.session as Record<string, unknown>).title).toBe("Selected");
  expect(JSON.stringify(session)).not.toContain(IDS.otherSession);
  expect(JSON.stringify(conversation)).toContain("selected private prompt");
  expect(JSON.stringify(conversation)).not.toContain("other session secret");
  expect(await workspaceFile(root, "notes/state.txt")).toBe("private workspace\n");
  expect(execution).toMatchObject({
    source: "print('ok')",
    stdout: "bounded stdout\n",
    stderr: "bounded stderr\n",
    vmDiagnostics: [{ code: "process_exit", platform: "guest" }],
  });
  expect(currentTrace).toMatchObject({
    captureVersion: 1,
    status: "recorded",
    turns: [{ prompt: "private effective prompt", structuredResponse: { action: "respond" } }],
  });
  expect(oldTrace).toEqual({
    runId: IDS.oldRun,
    captureVersion: 0,
    status: "not_recorded",
    turns: [],
  });
}

async function assertSnapshotArtifact(root: string): Promise<void> {
  const runRecord = await json(join(root, "logs", IDS.run, "run.json"));
  const artifacts = runRecord.artifacts as Array<Record<string, unknown>>;
  expect(artifacts[0]?.snapshotPath).toBe(`artifacts/${IDS.run}/${IDS.artifact}-result.txt`);
  expect(await readFile(join(root, String(artifacts[0]?.snapshotPath)), "utf8")).toBe(
    "generated artifact\n",
  );
}

afterEach(async () => {
  fixture?.database.close();
  fixture = undefined;
  await Promise.all(
    [...cleanup].map(async (path) => await rm(path, { recursive: true, force: true })),
  );
  cleanup.clear();
});

it("isolates one live session with workspace, bounded logs, artifacts, and traces", async () => {
  const state = await newFixture();
  state.database.exec("BEGIN IMMEDIATE");
  state.database
    .prepare("UPDATE sessions SET title = ? WHERE id = ?")
    .run("uncommitted desktop title", IDS.session);
  const root = await createSessionDebugSnapshot(state.databasePath, IDS.session);
  cleanup.add(root);
  state.database.exec("ROLLBACK");
  await assertSnapshotContent(root);
  await assertSnapshotArtifact(root);
  await assertPrivateTree(root);
});

it("prints a fresh temporary path from the Core diagnostic mode", async () => {
  const state = await newFixture();
  const arguments_ = [
    "--import",
    "tsx",
    "packages/core/src/daemon/main.ts",
    "debug-session",
    "--database",
    state.databasePath,
    "--session",
    IDS.session,
  ];
  const first = await run(process.execPath, arguments_, { cwd: process.cwd() });
  const second = await run(process.execPath, arguments_, { cwd: process.cwd() });
  const paths = [first.stdout.trim(), second.stdout.trim()];
  paths.forEach((path) => {
    cleanup.add(path);
  });

  expect(first.stderr).toBe("");
  expect(paths[0]).not.toBe(paths[1]);
  expect(paths.every((path) => path.startsWith(join(tmpdir(), "vault-session-debug-")))).toBe(true);
  expect(await lstat(join(paths[0] ?? "", "session.json"))).toBeDefined();
});

it("rejects invalid Core diagnostic arguments with only a typed error", async () => {
  try {
    await run(process.execPath, [
      "--import",
      "tsx",
      "packages/core/src/daemon/main.ts",
      "debug-session",
      "--database",
      "/not-enough-arguments",
    ]);
    throw new Error("Core diagnostic mode unexpectedly succeeded");
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toBe("debug_arguments_invalid\n");
  }
});

it("preserves guest paths that alias or are invalid on host filesystems", async () => {
  const state = await newFixture();
  const files = [
    { path: "Foo", value: "upper" },
    { path: "foo", value: "lower" },
    { path: "CON", value: "reserved" },
    { path: "report?.txt", value: "wildcard" },
    { path: "trailing.", value: "period" },
  ];
  await replaceWorkspace(state, files);
  const root = await createSessionDebugSnapshot(state.databasePath, IDS.session);
  cleanup.add(root);

  const manifest = await json(join(root, "workspace", "manifest.json"));
  const entries = manifest.entries as Array<Record<string, unknown>>;
  expect(entries.map((entry) => entry.path)).toEqual(files.map((file) => file.path));
  expect(new Set(entries.map((entry) => entry.snapshotPath)).size).toBe(files.length);
  for (const file of files) expect(await workspaceFile(root, file.path)).toBe(file.value);
  expect((await readdir(join(root, "workspace"))).sort()).toEqual(["files", "manifest.json"]);
});

it("rejects corrupted workspace and artifact bytes without retaining partial output", async () => {
  const state = await newFixture();
  const before = await debugDirectories();
  const workspaceBlob = join(state.internalRoot, "agent-workspaces", "blobs", state.workspaceBlob);
  await writeFile(workspaceBlob, "corrupt");
  await expect(createSessionDebugSnapshot(state.databasePath, IDS.session)).rejects.toThrow(
    "debug_content_hash_mismatch",
  );
  expect(await debugDirectories()).toEqual(before);

  await writeFile(workspaceBlob, "private workspace\n");
  await chmod(workspaceBlob, 0o600);
  await writeFile(artifactPath(state.internalRoot, state.artifactHash), "corrupt artifact");
  await expect(createSessionDebugSnapshot(state.databasePath, IDS.session)).rejects.toThrow(
    "debug_content_hash_mismatch",
  );
  expect(await debugDirectories()).toEqual(before);
});

it("fails safely on malformed persisted diagnostics", async () => {
  const state = await newFixture();
  state.database
    .prepare("UPDATE agent_executions SET vm_diagnostics_json = ? WHERE id = ?")
    .run("raw helper stderr must stay private", IDS.execution);

  await expect(createSessionDebugSnapshot(state.databasePath, IDS.session)).rejects.toThrow(
    "debug_state_invalid",
  );
  try {
    await run(process.execPath, [
      "--import",
      "tsx",
      "packages/core/src/daemon/main.ts",
      "debug-session",
      "--database",
      state.databasePath,
      "--session",
      IDS.session,
    ]);
    throw new Error("CLI unexpectedly succeeded");
  } catch (error) {
    const failure = error as { stderr?: string };
    expect(failure.stderr).toContain("debug_state_invalid");
    expect(failure.stderr).not.toContain("raw helper stderr must stay private");
  }
});

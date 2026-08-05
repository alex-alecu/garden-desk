import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactStore,
  AuditLog,
  createVaultCore,
  ScopedFileSystem,
  WorkspaceScope,
} from "@vault/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const temporaryRoots: string[] = [];

async function createTestCore(workspaceDir: string) {
  const modelStoreDir = join(workspaceDir, ".test-models");
  await mkdir(modelStoreDir, { recursive: true });
  await writeFile(
    join(modelStoreDir, "installed-models.json"),
    JSON.stringify({ schemaVersion: 1, models: [] }),
  );
  return createVaultCore({ workspaceDir, modelStoreDir, profile: "local12" });
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "vault-m1-workspace-"));
  temporaryRoots.push(root);
  return root;
}

async function createEscapeLink(parent: string, root: string): Promise<string> {
  if (process.platform === "win32") {
    const outside = join(parent, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "outside.txt"), "outside");
    await symlink(outside, join(root, "escape"), "junction");
    return "escape/outside.txt";
  }
  const outside = join(parent, "outside.txt");
  await writeFile(outside, "outside");
  await symlink(outside, join(root, "escape.txt"));
  return "escape.txt";
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("M1 workspace path and artifact security", () => {
  it("rejects traversal, symlink escape, and changed file identities", async () => {
    const parent = await temporaryRoot();
    const root = join(parent, "workspace");
    await mkdir(root);
    await writeFile(join(root, "input.txt"), "first");
    const escapePath = await createEscapeLink(parent, root);
    const files = new ScopedFileSystem(await WorkspaceScope.create(root));
    await expect(files.read("../outside.txt")).rejects.toThrow("path_out_of_scope");
    await expect(files.read(escapePath)).rejects.toThrow("path_out_of_scope");
    const snapshot = await files.snapshot("input.txt");
    await rename(join(root, "input.txt"), join(root, "old.txt"));
    await writeFile(join(root, "input.txt"), "replacement");
    await expect(files.readSnapshot(snapshot)).rejects.toThrow("path_changed");
  });
});

describe("M1 artifact security and identity", () => {
  it("writes immutable artifacts atomically and preserves workspace identity", async () => {
    const root = await temporaryRoot();
    const scope = await WorkspaceScope.create(root);
    const artifacts = await ArtifactStore.create(scope);
    const hash = await artifacts.put(Buffer.from("authoritative"));
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect((await artifacts.read(hash)).toString()).toBe("authoritative");
    await expect(artifacts.read("sha256:../../outside" as never)).rejects.toThrow();
    const digest = hash.slice("sha256:".length);
    await writeFile(join(root, ".vault", "artifacts", digest.slice(0, 2), digest), "tampered");
    await expect(artifacts.read(hash)).rejects.toThrow("artifact_hash_mismatch");
    await expect(artifacts.put(Buffer.from("authoritative"))).rejects.toThrow(
      "artifact_hash_mismatch",
    );
    const first = await createTestCore(root);
    const identity = (await first.status()).workspace.id;
    await expect(createTestCore(root)).rejects.toThrow("workspace_busy");
    await first.close();
    const reopened = await createTestCore(root);
    expect((await reopened.status()).workspace.id).toBe(identity);
    await reopened.close();
  });
});

describe("M1 internal workspace path security", () => {
  it("rejects a redirected internal workspace directory", async () => {
    const parent = await temporaryRoot();
    const root = join(parent, "workspace");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, ".vault"), process.platform === "win32" ? "junction" : "dir");
    await expect(createTestCore(root)).rejects.toThrow("workspace_directory_unsafe");
    await expect(ArtifactStore.create(await WorkspaceScope.create(root))).rejects.toThrow(
      "path_out_of_scope",
    );
  });
});

describe("M1 durable job cancellation", () => {
  it("reports cancellation only when a cancellable job transitions", async () => {
    const root = await temporaryRoot();
    const core = await createTestCore(root);
    const database = new Database(join(root, ".vault", "catalog.sqlite"));
    const now = new Date().toISOString();
    const jobId = "00000000-0000-4000-8000-000000000001";
    database
      .prepare("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(jobId, "probe", "completed-key", "succeeded", 0, null, now, now);
    database.close();
    expect(await core.cancelJob(jobId)).toBe(false);
    await core.close();
  });
});

describe("M1 authoritative state recovery", () => {
  it("rolls back an authoritative transaction killed before commit", async () => {
    const root = await temporaryRoot();
    const core = await createTestCore(root);
    await core.close();
    const databasePath = join(root, ".vault", "catalog.sqlite");
    const script = [
      'import Database from "better-sqlite3";',
      "const db = new Database(process.argv[1]);",
      'db.exec("BEGIN IMMEDIATE");',
      `db.prepare("INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("00000000-0000-4000-8000-000000000001", "probe", "crash-key", "running", 0, null, new Date().toISOString(), new Date().toISOString());`,
      'process.kill(process.pid, "SIGKILL");',
    ].join("\n");
    spawnSync(process.execPath, ["--input-type=module", "-e", script, databasePath]);
    const database = new Database(databasePath);
    const row = database.prepare("SELECT count(*) AS count FROM jobs").get() as { count: number };
    database.close();
    expect(row.count).toBe(0);
  });
});

describe("M1 audit integrity", () => {
  it("redacts routine content and detects a modified audit record", async () => {
    const root = await temporaryRoot();
    const core = await createTestCore(root);
    await core.close();
    const database = new Database(join(root, ".vault", "catalog.sqlite"));
    const audit = new AuditLog(database);
    const event = audit.append({
      type: "document.observed",
      outcome: "succeeded",
      metadata: { documentText: "sensitive", pathHash: "sha256:example" },
    });
    expect(event.metadata.documentText).toBe("[REDACTED]");
    expect(audit.verify()).toBe(true);
    const row = database
      .prepare("SELECT event_json FROM audit_events WHERE sequence = 0")
      .get() as { event_json: string };
    const changed = { ...(JSON.parse(row.event_json) as object), type: "tampered" };
    database.exec("DROP TRIGGER audit_events_no_update");
    database
      .prepare("UPDATE audit_events SET event_json = ? WHERE sequence = 0")
      .run(JSON.stringify(changed));
    expect(audit.verify()).toBe(false);
    database.close();
  });

  it("detects a truncated audit tail and refuses to extend it", async () => {
    const root = await temporaryRoot();
    const core = await createTestCore(root);
    await core.close();
    const database = new Database(join(root, ".vault", "catalog.sqlite"));
    const audit = new AuditLog(database);
    expect(audit.verify()).toBe(true);
    database.exec("DROP TRIGGER audit_events_no_delete");
    database.exec(
      "DELETE FROM audit_events WHERE sequence = (SELECT max(sequence) FROM audit_events)",
    );
    expect(audit.verify()).toBe(false);
    expect(() =>
      audit.append({ type: "core.reopened", outcome: "succeeded", metadata: {} }),
    ).toThrow("audit_chain_invalid");
    database.close();
  });
});

describe("M1 workspace migration", () => {
  it("anchors an existing version-one audit chain", async () => {
    const root = await temporaryRoot();
    const first = await createTestCore(root);
    await first.close();
    const database = new Database(join(root, ".vault", "catalog.sqlite"));
    database.exec(
      "DROP TABLE agent_inference_turns; DROP TABLE agent_executions; DROP TABLE agent_artifacts; DROP TABLE agent_events; DROP TABLE agent_runs; DROP TABLE session_attachments; DROP TABLE session_drafts; DROP TABLE conversation_messages; DROP TABLE sessions; DROP TABLE folder_grants; DROP TRIGGER audit_head_no_delete; DROP TABLE audit_head; PRAGMA user_version = 1",
    );
    database.close();
    const migrated = await createTestCore(root);
    expect((await migrated.status()).catalogSchemaVersion).toBe(10);
    expect(await migrated.verifyAudit()).toBe(true);
    await migrated.close();
  });

  it("creates a consistent backup before applying a numbered migration", async () => {
    const root = await temporaryRoot();
    const internalRoot = join(root, ".vault");
    await mkdir(internalRoot);
    const databasePath = join(internalRoot, "catalog.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec("CREATE TABLE legacy_marker (value TEXT NOT NULL)");
    legacy.prepare("INSERT INTO legacy_marker VALUES (?)").run("before-migration");
    legacy.close();
    const core = await createTestCore(root);
    expect((await core.status()).catalogSchemaVersion).toBe(10);
    await core.close();
    const backupName = (await readdir(internalRoot)).find((name) =>
      name.startsWith("catalog.sqlite.pre-migration-v0-"),
    );
    expect(backupName).toBeDefined();
    const backup = new Database(join(internalRoot, backupName ?? "missing"), { readonly: true });
    const marker = backup.prepare("SELECT value FROM legacy_marker").get() as { value: string };
    expect(marker.value).toBe("before-migration");
    expect(backup.pragma("user_version", { simple: true })).toBe(0);
    backup.close();
  });
});

describe("M3 conversation audit atomicity", () => {
  it("rolls back a session when the audit chain cannot be extended", async () => {
    const root = await temporaryRoot();
    const core = await createTestCore(root);
    const database = new Database(join(root, ".vault", "catalog.sqlite"));
    const row = database
      .prepare("SELECT event_json FROM audit_events WHERE sequence = 0")
      .get() as { event_json: string };
    const changed = { ...(JSON.parse(row.event_json) as object), type: "tampered" };
    database.exec("DROP TRIGGER audit_events_no_update");
    database
      .prepare("UPDATE audit_events SET event_json = ? WHERE sequence = 0")
      .run(JSON.stringify(changed));

    await expect(core.createSession(null)).rejects.toThrow("audit_chain_invalid");
    const count = database.prepare("SELECT count(*) AS count FROM sessions").get() as {
      count: number;
    };
    expect(count.count).toBe(0);

    database
      .prepare("UPDATE audit_events SET event_json = ? WHERE sequence = 0")
      .run(row.event_json);
    database.close();
    await core.close();
  });
});

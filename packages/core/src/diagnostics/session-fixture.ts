import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const IDS = {
  folder: "11111111-1111-4111-8111-111111111111",
  session: "22222222-2222-4222-8222-222222222222",
  otherSession: "33333333-3333-4333-8333-333333333333",
  message: "44444444-4444-4444-8444-444444444444",
  otherMessage: "55555555-5555-4555-8555-555555555555",
  attachment: "66666666-6666-4666-8666-666666666666",
  job: "77777777-7777-4777-8777-777777777777",
  run: "88888888-8888-4888-8888-888888888888",
  event: "99999999-9999-4999-8999-999999999999",
  execution: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  artifact: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  oldJob: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  oldRun: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  turn: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
} as const;

const NOW = "2026-07-24T12:00:00.000Z";
const migrationRoot = fileURLToPath(new URL("../workspace/migrations/", import.meta.url));

export interface DebugFixture {
  root: string;
  internalRoot: string;
  databasePath: string;
  database: DatabaseSync;
  workspaceBlob: string;
  artifactHash: string;
}

async function applyMigrations(database: DatabaseSync): Promise<void> {
  for (let version = 1; version <= 8; version += 1) {
    const names = [
      "initial",
      "audit-head",
      "conversations",
      "agent",
      "agent-performance",
      "agent-workspace",
      "agent-executions",
      "agent-inference-traces",
    ];
    const name = `${String(version).padStart(4, "0")}-${names[version - 1]}.sql`;
    database.exec(await readFile(join(migrationRoot, name), "utf8"));
  }
}

async function storeArtifact(internalRoot: string, value: string): Promise<string> {
  const bytes = Buffer.from(value);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const directory = join(internalRoot, "artifacts", digest.slice(0, 2));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, digest), bytes, { mode: 0o600 });
  return `sha256:${digest}`;
}

async function createWorkspace(internalRoot: string): Promise<string> {
  const bytes = Buffer.from("private workspace\n");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const root = join(internalRoot, "agent-workspaces");
  await mkdir(join(root, "blobs"), { recursive: true, mode: 0o700 });
  await mkdir(join(root, "manifests"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "blobs", digest), bytes, { mode: 0o600 });
  await writeFile(
    join(root, "manifests", `${IDS.session}.json`),
    JSON.stringify({
      version: 1,
      entries: [
        { kind: "directory", path: "notes" },
        {
          kind: "file",
          path: "notes/state.txt",
          contentHash: digest,
          byteLength: bytes.byteLength,
        },
      ],
    }),
    { mode: 0o600 },
  );
  return digest;
}

function insertSessions(database: DatabaseSync): void {
  database
    .prepare("INSERT INTO folder_grants VALUES (?, ?, ?, ?, NULL)")
    .run(IDS.folder, "/private/client", "Client", NOW);
  database
    .prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)")
    .run(IDS.session, IDS.folder, "Selected", NOW, NOW);
  database
    .prepare("INSERT INTO sessions VALUES (?, NULL, ?, ?, ?)")
    .run(IDS.otherSession, "Other", NOW, NOW);
  database
    .prepare("INSERT INTO conversation_messages VALUES (?, ?, ?, ?, ?, NULL)")
    .run(IDS.message, IDS.session, "user", "selected private prompt", NOW);
  database
    .prepare("INSERT INTO conversation_messages VALUES (?, ?, ?, ?, ?, NULL)")
    .run(IDS.otherMessage, IDS.otherSession, "user", "other session secret", NOW);
  database
    .prepare("INSERT INTO session_drafts VALUES (?, ?, ?)")
    .run(IDS.session, "private draft", NOW);
  database
    .prepare("INSERT INTO session_attachments VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      IDS.attachment,
      IDS.session,
      "input.txt",
      "text/plain",
      3,
      `sha256:${"0".repeat(64)}`,
      NOW,
    );
}

function insertRuns(database: DatabaseSync): void {
  const insertJob = database.prepare(
    "INSERT INTO jobs VALUES (?, 'agent', ?, 'succeeded', 0, NULL, ?, ?)",
  );
  insertJob.run(IDS.job, "current", NOW, NOW);
  insertJob.run(IDS.oldJob, "old", NOW, NOW);
  database
    .prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'succeeded', ?, NULL, ?, ?, NULL, 1)")
    .run(IDS.run, IDS.session, IDS.job, "done", NOW, NOW);
  database
    .prepare("INSERT INTO agent_runs VALUES (?, ?, ?, 'succeeded', ?, NULL, ?, ?, NULL, 0)")
    .run(IDS.oldRun, IDS.session, IDS.oldJob, "historical", NOW, NOW);
  insertExecutionEvidence(database);
}

function insertExecutionEvidence(database: DatabaseSync): void {
  database
    .prepare(
      "INSERT INTO agent_events VALUES (?, ?, 0, 'execution.completed', ?, 'python', ?, ?, ?, 'completed', ?, ?, NULL, 0, 3)",
    )
    .run(
      IDS.event,
      IDS.run,
      "Python completed.",
      "print('ok')",
      "legacy out",
      "legacy err",
      NOW,
      "steps/main.py",
    );
  database
    .prepare(
      "INSERT INTO agent_executions VALUES (?, ?, 0, 'python', ?, ?, NULL, 'completed', 0, 3, 'completed', ?, ?, ?, 0, 0, 0, ?, ?, ?)",
    )
    .run(
      IDS.execution,
      IDS.run,
      "steps/main.py",
      "print('ok')",
      Buffer.from("bounded stdout\n"),
      Buffer.from("bounded stderr\n"),
      JSON.stringify([
        {
          sequence: 0,
          code: "process_exit",
          platform: "guest",
          platformCode: null,
          createdAt: NOW,
        },
      ]),
      NOW,
      NOW,
      NOW,
    );
}

async function insertTrace(database: DatabaseSync, internalRoot: string): Promise<string> {
  const promptHash = await storeArtifact(internalRoot, "private effective prompt");
  const schemaHash = await storeArtifact(internalRoot, JSON.stringify({ type: "object" }));
  const responseHash = await storeArtifact(
    internalRoot,
    JSON.stringify({ action: "respond", response: "ok" }),
  );
  database
    .prepare(
      "INSERT INTO agent_inference_turns VALUES (?, ?, 0, 'decision', 'request-1', ?, 'gemma', 'auto', 1024, 8192, ?, ?, ?, 'accepted_response', NULL, ?, ?, ?)",
    )
    .run(IDS.turn, IDS.run, IDS.job, promptHash, schemaHash, responseHash, NOW, NOW, NOW);
  return await storeArtifact(internalRoot, "generated artifact\n");
}

export async function createDebugFixture(): Promise<DebugFixture> {
  const root = await mkdtemp(join(tmpdir(), "vault-debug-fixture-"));
  const internalRoot = join(root, "state", ".vault");
  await mkdir(internalRoot, { recursive: true, mode: 0o700 });
  await chmod(internalRoot, 0o700);
  const databasePath = join(internalRoot, "catalog.sqlite");
  const database = new DatabaseSync(databasePath);
  await applyMigrations(database);
  database.exec("PRAGMA journal_mode = WAL");
  insertSessions(database);
  insertRuns(database);
  const artifactHash = await insertTrace(database, internalRoot);
  database
    .prepare("INSERT INTO agent_artifacts VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(IDS.artifact, IDS.run, "../result.txt", "text/plain", 19, artifactHash, NOW);
  const workspaceBlob = await createWorkspace(internalRoot);
  return { root, internalRoot, databasePath, database, workspaceBlob, artifactHash };
}

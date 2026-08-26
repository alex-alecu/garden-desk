import { randomUUID } from "node:crypto";
// biome-ignore lint/style/noRestrictedImports: isolated persistence tests use owner-temporary state.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-tool-persistence-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  return {
    catalog,
    jobs: new JobStore(catalog.database),
    sessions: new ConversationStore(catalog.database),
    store: new AgentStore(catalog.database, await ArtifactStore.create(scope)),
  };
}

function completePython(
  store: AgentStore,
  runId: string,
  input: { path: string; exitCode: number; source?: string },
): string {
  const { path, exitCode, source = "print('test')" } = input;
  const execution = store.execution.create(runId, { language: "python", path, source });
  store.execution.complete(execution.id, {
    language: "python",
    path,
    source,
    command: null,
    exitCode,
    stdout: "",
    stderr: "",
    durationMs: 1,
    termination: "completed",
    artifacts: [],
  });
  return execution.id;
}

const RECENT_SCRIPT_PATHS = [
  "steps/script-0.py",
  "steps/script-8.py",
  "steps/script-7.py",
  "steps/script-6.py",
  "steps/script-5.py",
  "steps/script-4.py",
  "steps/script-3.py",
  "steps/script-2.py",
];

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: focused cases cover one migration boundary.
describe("agent tool persistence", () => {
  it("persists child-run and tool-event identity", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const parent = store.createRun(session.id, jobs.create("agent", "parent").id);
    const child = store.createRun(session.id, jobs.create("agent", "child").id, parent.id);
    store.appendEvent(child.id, "tool.started", "Reading the workspace.", {
      toolName: "read",
      toolCallId: "call-1",
    });

    expect(catalog.schemaVersion).toBe(13);
    expect(store.snapshot(child.id)).toMatchObject({
      run: { parentRunId: parent.id },
      events: [{ type: "tool.started", toolName: "read", toolCallId: "call-1" }],
    });
    catalog.close();
  });

  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: one case proves the rebuilt SQL checks together.
  it("accepts future execution languages and chat trace outcomes in SQLite", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const run = store.createRun(session.id, jobs.create("agent", "generic-tool").id);
    const now = new Date().toISOString();
    catalog.database
      .prepare(
        "INSERT INTO agent_executions (id, run_id, sequence, language, state, created_at, updated_at) VALUES (?, ?, 0, 'generic-tool', 'starting', ?, ?)",
      )
      .run(randomUUID(), run.id, now, now);
    const insertTurn = catalog.database.prepare(
      "INSERT INTO agent_inference_turns (id, run_id, sequence, phase, request_id, job_id, model_id, context_size, max_tokens, prompt_hash, schema_hash, outcome, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 'test', 'auto', 1024, 'prompt', 'schema', ?, ?, ?)",
    );
    insertTurn.run(
      randomUUID(),
      run.id,
      0,
      "chat",
      randomUUID(),
      run.jobId,
      "accepted_tool_calls",
      now,
      now,
    );
    insertTurn.run(
      randomUUID(),
      run.id,
      1,
      "compaction",
      randomUUID(),
      run.jobId,
      "accepted_compaction",
      now,
      now,
    );

    expect(
      catalog.database
        .prepare("SELECT language FROM agent_executions WHERE run_id = ?")
        .get(run.id),
    ).toEqual({ language: "generic-tool" });
    expect(
      catalog.database
        .prepare(
          "SELECT phase, outcome FROM agent_inference_turns WHERE run_id = ? ORDER BY sequence",
        )
        .all(run.id),
    ).toEqual([
      { phase: "chat", outcome: "accepted_tool_calls" },
      { phase: "compaction", outcome: "accepted_compaction" },
    ]);
    catalog.close();
  });

  it("lists committed script paths for follow-up runs by their newest use", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const first = store.createRun(session.id, jobs.create("agent", "first").id);
    const second = store.createRun(session.id, jobs.create("agent", "second").id);
    completePython(store, first.id, { path: "steps/extract.py", exitCode: 0 });
    completePython(store, second.id, {
      path: "steps/broken.py",
      exitCode: 1,
      source: "raise SystemExit(1)",
    });
    completePython(store, second.id, { path: ".vault-tools/internal.py", exitCode: 1 });
    const preparedFailure = store.execution.create(second.id, {
      language: "python",
      path: "steps/not-committed.py",
      source: "print('not committed')",
    });
    catalog.database
      .prepare(
        "UPDATE agent_executions SET state = 'failed', termination = 'crash', completed_at = ?, updated_at = ? WHERE id = ?",
      )
      .run("2026-08-26T10:00:00.000Z", "2026-08-26T10:00:00.000Z", preparedFailure.id);

    expect(store.execution.listSessionScriptPaths(session.id)).toEqual([
      "steps/broken.py",
      "steps/extract.py",
    ]);
    expect(store.execution.listSessionScriptPaths(randomUUID())).toEqual([]);
    catalog.close();
  });

  it("limits duplicate script paths by their latest use with a stable tie order", async () => {
    const { catalog, jobs, sessions, store } = await fixture();
    const session = sessions.createSession(null);
    const run = store.createRun(session.id, jobs.create("agent", "scripts").id);
    const created = Array.from({ length: 9 }, (_, index) => {
      const path = `steps/script-${index}.py`;
      return {
        id: completePython(store, run.id, { path, exitCode: 0, source: `print(${index})` }),
        path,
      };
    });
    const rerunId = completePython(store, run.id, {
      path: "steps/script-0.py",
      exitCode: 0,
      source: "print('newest')",
    });

    const updateCreatedAt = catalog.database.prepare(
      "UPDATE agent_executions SET created_at = ? WHERE id = ?",
    );
    for (const [index, execution] of created.entries()) {
      updateCreatedAt.run(`2026-08-26T10:00:0${index}.000Z`, execution.id);
    }
    updateCreatedAt.run("2026-08-26T10:00:10.000Z", rerunId);

    expect(store.execution.listSessionScriptPaths(session.id)).toEqual(RECENT_SCRIPT_PATHS);

    const tiedId = created[8]?.id;
    if (tiedId === undefined) throw new Error("missing_tied_execution");
    updateCreatedAt.run("2026-08-26T10:00:10.000Z", tiedId);
    expect(store.execution.listSessionScriptPaths(session.id, 2)).toEqual([
      "steps/script-0.py",
      "steps/script-8.py",
    ]);
    catalog.close();
  });
});

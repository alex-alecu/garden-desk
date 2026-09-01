import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGardenDeskCore } from "@gardendesk/core";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

async function openCore(root: string) {
  const models = join(root, "models");
  await mkdir(models, { recursive: true });
  await writeFile(
    join(models, "installed-models.json"),
    JSON.stringify({ schemaVersion: 1, models: [] }),
  );
  return createGardenDeskCore({ workspaceDir: root, modelStoreDir: models, profile: "local12" });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("M3 anchored session summary catalog", () => {
  it("migrates to the anchored-summary schema version", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-summary-"));
    roots.push(root);
    const core = await openCore(root);
    expect((await core.status()).catalogSchemaVersion).toBe(13);
    await core.close();
  });

  it("keeps one replaceable anchor per session and removes it with the session", async () => {
    const root = await mkdtemp(join(tmpdir(), "garden-desk-summary-"));
    roots.push(root);
    const core = await openCore(root);
    const session = await core.createSession(null);
    await core.close();

    const database = new Database(join(root, ".garden-desk", "catalog.sqlite"));
    const now = new Date().toISOString();
    const runId = "33333333-3333-4333-8333-333333333333";
    const jobId = "22222222-2222-4222-8222-222222222222";
    database
      .prepare("INSERT INTO jobs VALUES (?, 'agent', 'summary-run', 'succeeded', 0, NULL, ?, ?)")
      .run(jobId, now, now);
    database
      .prepare(
        "INSERT INTO agent_runs (id, session_id, job_id, state, response, error, created_at, updated_at, performance_json) VALUES (?, ?, ?, 'succeeded', NULL, NULL, ?, ?, NULL)",
      )
      .run(runId, session.id, jobId, now, now);
    const upsert =
      "INSERT INTO agent_session_summaries (session_id, run_id, text, covered_message_id, covered_message_count, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET text = excluded.text, covered_message_id = excluded.covered_message_id, covered_message_count = excluded.covered_message_count";
    database.prepare(upsert).run(session.id, runId, "## Objective\n- First.", "m2", 2, now);
    database.prepare(upsert).run(session.id, runId, "## Objective\n- Second.", "m4", 4, now);

    const anchored = database
      .prepare("SELECT text, covered_message_count AS count FROM agent_session_summaries")
      .all() as Array<{ text: string; count: number }>;
    expect(anchored).toHaveLength(1);
    expect(anchored[0]?.text).toBe("## Objective\n- Second.");
    expect(anchored[0]?.count).toBe(4);

    database.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
    const remaining = database
      .prepare("SELECT COUNT(*) AS total FROM agent_session_summaries")
      .get() as { total: number };
    expect(remaining.total).toBe(0);
    database.close();
  });
});

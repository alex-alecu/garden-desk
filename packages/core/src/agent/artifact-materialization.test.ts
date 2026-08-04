import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { exportAndAuditArtifact, materializeArtifact } from "./artifact-materialization.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-deliverable-test-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const artifacts = await ArtifactStore.create(scope);
  const store = new AgentStore(catalog.database, artifacts);
  const conversations = new ConversationStore(catalog.database);
  const session = conversations.createSession(null);
  const job = new JobStore(catalog.database).create("agent", crypto.randomUUID());
  const run = store.createRun(session.id, job.id);
  const bytes = Buffer.from("verified deliverable");
  const item = store.addArtifact(run.id, {
    name: "reports/summary.pdf",
    mediaType: "application/pdf",
    byteLength: bytes.byteLength,
    contentHash: await artifacts.put(bytes),
  });
  return { root, catalog, artifacts, store, session, item, bytes };
}

describe("artifact materialization and export", () => {
  it("verifies ownership and hash before opening an owner-only temporary copy", async () => {
    const { root, catalog, artifacts, session, item, bytes } = await fixture();
    const path = await materializeArtifact({
      database: catalog.database,
      artifacts,
      sessionId: session.id,
      artifactId: item.id,
    });
    expect(await readFile(path)).toEqual(bytes);
    await expect(
      materializeArtifact({
        database: catalog.database,
        artifacts,
        sessionId: crypto.randomUUID(),
        artifactId: item.id,
      }),
    ).rejects.toThrow("artifact_not_found");
    const digest = item.contentHash.slice("sha256:".length);
    await writeFile(join(root, ".vault", "artifacts", digest.slice(0, 2), digest), "tampered");
    await expect(
      materializeArtifact({
        database: catalog.database,
        artifacts,
        sessionId: session.id,
        artifactId: item.id,
      }),
    ).rejects.toThrow("artifact_hash_mismatch");
    catalog.close();
  });
});

describe("artifact export", () => {
  it("writes atomically, rejects symlink targets, and redacts the destination from audit", async () => {
    const { root, catalog, artifacts, session, item, bytes } = await fixture();
    const destination = join(root, "saved.pdf");
    await writeFile(destination, "old");
    const audit = new AuditLog(catalog.database);
    await exportAndAuditArtifact({
      database: catalog.database,
      artifacts,
      audit,
      sessionId: session.id,
      artifactId: item.id,
      destination,
    });
    expect(await readFile(destination)).toEqual(bytes);

    const target = join(root, "target.pdf");
    const link = join(root, "linked.pdf");
    await writeFile(target, "target");
    await symlink(target, link);
    await expect(
      exportAndAuditArtifact({
        database: catalog.database,
        artifacts,
        audit,
        sessionId: session.id,
        artifactId: item.id,
        destination: link,
      }),
    ).rejects.toThrow("artifact_export_unsafe");

    const events = catalog.database
      .prepare("SELECT event_json FROM audit_events ORDER BY sequence")
      .all() as Array<{ event_json: string }>;
    expect(events.at(-1)?.event_json).toContain("artifact.exported");
    expect(events.at(-1)?.event_json).toContain('"outcome":"failed"');
    expect(events.at(-1)?.event_json).not.toContain(destination);
    expect(events.at(-1)?.event_json).not.toContain(link);
    catalog.close();
  });
});

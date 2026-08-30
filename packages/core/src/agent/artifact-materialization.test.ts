import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentExecutionResult } from "@vault/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLog } from "../audit/log.js";
import { ConversationStore } from "../conversations/store.js";
import { JobStore } from "../jobs/jobs.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import {
  ArtifactMaterializer,
  exportAndAuditArtifact,
  materializeArtifact,
} from "./artifact-materialization.js";
import { artifactCandidateNames } from "./artifact-results.js";
import { AgentImageInputResolver } from "./image-inputs.js";
import { AgentStore } from "./store.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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

async function imageFixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-image-input-test-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const store = new AgentStore(catalog.database, await ArtifactStore.create(scope));
  const conversations = new ConversationStore(catalog.database);
  return { root, catalog, store, conversations };
}

describe("artifact path policy", () => {
  it("does not expose working scripts as user artifacts", () => {
    const script: Pick<AgentExecutionResult, "artifacts"> = {
      artifacts: [
        {
          name: "steps/repair.py",
          mediaType: "application/octet-stream",
          bytesBase64: Buffer.from("steps/repair.py").toString("base64"),
        },
      ],
    };
    expect(artifactCandidateNames([script])).toEqual([]);
  });
});

describe("agent image input security", () => {
  it("rejects a selected-folder link that escapes the grant", async () => {
    const { root, catalog, store, conversations } = await imageFixture();
    const selected = join(root, "selected");
    await mkdir(selected);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "outside.png"), PNG);
    await symlink(
      outside,
      join(selected, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const folder = conversations.addFolder(selected);
    const session = conversations.createSession(folder.id);
    const resolver = new AgentImageInputResolver(catalog.database, store);

    await expect(resolver.resolve(session.id, "/source/escape/outside.png")).rejects.toThrow(
      "image_path_outside_context",
    );
    catalog.close();
  });

  it("rejects an oversized attachment before loading its artifact bytes", async () => {
    const { root, catalog, store, conversations } = await imageFixture();
    const source = join(root, "large.png");
    await writeFile(source, PNG);
    const session = conversations.createSession(null);
    const item = await store.addAttachment(session.id, source);
    catalog.database
      .prepare("UPDATE session_attachments SET byte_length = ? WHERE id = ?")
      .run(32 * 1024 * 1024 + 1, item.id);
    const readBytes = vi.spyOn(store, "attachmentBytes");

    await expect(
      new AgentImageInputResolver(catalog.database, store).resolve(
        session.id,
        "/run/attachments/01-large.png",
      ),
    ).rejects.toThrow("image_size_unsupported");
    expect(readBytes).not.toHaveBeenCalled();
    catalog.close();
  });
});

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

  it("records the native Open result after materialization", async () => {
    const { catalog, artifacts, session, item } = await fixture();
    const audit = new AuditLog(catalog.database);
    const materializer = new ArtifactMaterializer(catalog.database, artifacts, audit);
    await materializer.materialize(session.id, item.id);
    expect(catalog.database.prepare("SELECT COUNT(*) AS count FROM audit_events").get()).toEqual({
      count: 0,
    });
    materializer.recordOpen(session.id, item.id, "failed");
    const event = catalog.database.prepare("SELECT event_json FROM audit_events").get() as {
      event_json: string;
    };
    expect(event.event_json).toContain('"type":"artifact.opened"');
    expect(event.event_json).toContain('"outcome":"failed"');
    catalog.close();
  });
});

describe("artifact export", () => {
  it("writes atomically, rejects symlink targets, and redacts the destination from audit", async () => {
    const { root, catalog, artifacts, session, item, bytes } = await fixture();
    const destination = join(root, "saved.pdf");
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
    if (process.platform === "win32") await mkdir(target);
    else await writeFile(target, "target");
    await symlink(target, link, process.platform === "win32" ? "junction" : "file");
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

describe("artifact export collisions", () => {
  it("never replaces an existing destination", async () => {
    const { root, catalog, artifacts, session, item } = await fixture();
    const destination = join(root, "existing.pdf");
    await writeFile(destination, "existing");
    await expect(
      exportAndAuditArtifact({
        database: catalog.database,
        artifacts,
        audit: new AuditLog(catalog.database),
        sessionId: session.id,
        artifactId: item.id,
        destination,
      }),
    ).rejects.toThrow("artifact_export_exists");
    expect(await readFile(destination, "utf8")).toBe("existing");
    catalog.close();
  });
});

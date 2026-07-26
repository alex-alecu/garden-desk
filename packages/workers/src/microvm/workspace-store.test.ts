import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentWorkspaceStore } from "./workspace-store.js";

const roots: string[] = [];

function file(path: string, bytes: Buffer) {
  return {
    kind: "file" as const,
    path,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    bytesBase64: bytes.toString("base64"),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("persistent agent workspace manifests", () => {
  it("atomically commits and rehydrates content-addressed files and empty directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    const sessionId = randomUUID();
    const bytes = Buffer.from("persistent result");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    await store.commit(sessionId, [
      { kind: "directory", path: "empty" },
      { kind: "file", path: "results/out.txt", contentHash, bytesBase64: bytes.toString("base64") },
    ]);

    const restored = await AgentWorkspaceStore.create(root);
    expect(await restored.load(sessionId)).toEqual([
      { kind: "directory", path: "empty" },
      { kind: "file", path: "results/out.txt", contentHash, bytesBase64: bytes.toString("base64") },
    ]);
    const retainedSessionId = randomUUID();
    await restored.commit(retainedSessionId, [
      { kind: "file", path: "shared.txt", contentHash, bytesBase64: bytes.toString("base64") },
    ]);
    await restored.delete(sessionId);
    expect(await restored.load(sessionId)).toEqual([]);
    await expect(stat(join(root, "blobs", contentHash))).resolves.toMatchObject({
      size: bytes.length,
    });
    await restored.delete(retainedSessionId);
    await expect(stat(join(root, "blobs", contentHash))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversing paths and mismatched content", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-invalid-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    await expect(
      store.commit(randomUUID(), [
        { kind: "file", path: "../escape", contentHash: "0".repeat(64), bytesBase64: "eA==" },
      ]),
    ).rejects.toThrow();
    await expect(
      store.commit(randomUUID(), [
        { kind: "file", path: "safe", contentHash: "0".repeat(64), bytesBase64: "eA==" },
      ]),
    ).rejects.toThrow("workspace_content_hash_mismatch");
    const bytes = Buffer.from("x");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    await expect(
      store.commit(randomUUID(), [
        { kind: "file", path: "parent", contentHash, bytesBase64: bytes.toString("base64") },
        { kind: "file", path: "parent/child", contentHash, bytesBase64: bytes.toString("base64") },
      ]),
    ).rejects.toThrow("workspace_manifest_invalid");
  });
});

describe("agent workspace deltas", () => {
  it("applies changed, added, and removed paths before committing a new manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-delta-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    const sessionId = randomUUID();
    const before = Buffer.from("before");
    const after = Buffer.from("after");
    const added = Buffer.from("added");
    await store.commit(sessionId, [
      file("changed.txt", before),
      { kind: "directory", path: "removed" },
      file("removed/file.txt", before),
    ]);

    await store.applyDelta(sessionId, {
      entries: [file("changed.txt", after), file("added.txt", added)],
      removedPaths: ["removed", "removed/file.txt"],
    });

    expect(await store.load(sessionId)).toEqual([
      file("added.txt", added),
      file("changed.txt", after),
    ]);
    const beforeHash = createHash("sha256").update(before).digest("hex");
    await expect(stat(join(root, "blobs", beforeHash))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves concurrent commits from different agent sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-concurrent-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    const bytes = Buffer.alloc(4 * 1024 * 1024, "shared");
    const sessionIds = Array.from({ length: 4 }, () => randomUUID());

    await Promise.all(
      sessionIds.map((sessionId, index) =>
        store.applyDelta(sessionId, {
          entries: [file(`result-${index}.txt`, bytes)],
          removedPaths: [],
        }),
      ),
    );

    await Promise.all(
      sessionIds.map(async (sessionId, index) => {
        expect(await store.load(sessionId)).toEqual([file(`result-${index}.txt`, bytes)]);
      }),
    );
  });
});

describe("agent workspace blob integrity", () => {
  it("rejects a same-length corrupted content-addressed blob", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-corrupt-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    const sessionId = randomUUID();
    const bytes = Buffer.from("original");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    await store.commit(sessionId, [
      { kind: "file", path: "result.txt", contentHash, bytesBase64: bytes.toString("base64") },
    ]);
    await writeFile(join(root, "blobs", contentHash), "corrupt!");
    await expect(store.load(sessionId)).rejects.toThrow("workspace_blob_invalid");
  });

  it("rejects a content-addressed blob replaced by an escaping link", async () => {
    const root = await mkdtemp(join(tmpdir(), "vault-workspace-store-link-"));
    roots.push(root);
    const store = await AgentWorkspaceStore.create(root);
    const sessionId = randomUUID();
    const bytes = Buffer.from("outside");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    await store.commit(sessionId, [file("result.txt", bytes)]);
    const outside = join(root, "outside.txt");
    const blob = join(root, "blobs", contentHash);
    await writeFile(outside, bytes);
    await rm(blob);
    await symlink(outside, blob);

    await expect(store.load(sessionId)).rejects.toThrow("workspace_blob_invalid");
  });
});

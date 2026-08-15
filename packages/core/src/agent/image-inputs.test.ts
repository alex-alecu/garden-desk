// biome-ignore lint/style/noRestrictedImports: isolated image fixtures use temporary files.
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationStore } from "../conversations/store.js";
import { ArtifactStore } from "../workspace/artifacts.js";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { WorkspaceScope } from "../workspace/scope.js";
import { AgentImageInputResolver } from "./image-inputs.js";
import { AgentStore } from "./store.js";

const roots: string[] = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vault-image-input-test-"));
  roots.push(root);
  const scope = await WorkspaceScope.create(root);
  const catalog = openWorkspaceCatalog(scope.root);
  const store = new AgentStore(catalog.database, await ArtifactStore.create(scope));
  const conversations = new ConversationStore(catalog.database);
  return { root, catalog, store, conversations };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent image inputs", () => {
  it("materializes an immutable PNG attachment for one inspection", async () => {
    const { root, catalog, store, conversations } = await fixture();
    const source = join(root, "receipt.png");
    await writeFile(source, PNG);
    const session = conversations.createSession(null);
    await store.addAttachment(session.id, source);

    const image = await new AgentImageInputResolver(catalog.database, store).resolve(
      session.id,
      "/run/attachments/01-receipt.png",
    );
    expect(await access(image.path).then(() => true)).toBe(true);
    await image.dispose();
    await expect(access(image.path)).rejects.toBeDefined();
    catalog.close();
  });

  it("accepts a regular image below the selected folder", async () => {
    const { root, catalog, store, conversations } = await fixture();
    const selected = join(root, "selected");
    await mkdir(selected);
    await writeFile(join(selected, "photo.jpg"), PNG);
    const folder = conversations.addFolder(selected);
    const session = conversations.createSession(folder.id);
    const resolver = new AgentImageInputResolver(catalog.database, store);

    const image = await resolver.resolve(session.id, "/source/photo.jpg");
    await image.dispose();
    catalog.close();
  });
});

describe("agent image input rejection", () => {
  it("rejects a selected-folder link that escapes the grant", async () => {
    const { root, catalog, store, conversations } = await fixture();
    const selected = join(root, "selected");
    await mkdir(selected);
    const outside = join(root, "outside.png");
    await writeFile(outside, PNG);
    await symlink(outside, join(selected, "escape.png"));
    const folder = conversations.addFolder(selected);
    const session = conversations.createSession(folder.id);
    const resolver = new AgentImageInputResolver(catalog.database, store);

    await expect(resolver.resolve(session.id, "/source/escape.png")).rejects.toThrow(
      "image_path_outside_context",
    );
    catalog.close();
  });

  it("rejects bytes that are not a supported image", async () => {
    const { root, catalog, store, conversations } = await fixture();
    const source = join(root, "fake.png");
    await writeFile(source, "not an image");
    const session = conversations.createSession(null);
    await store.addAttachment(session.id, source);
    await expect(
      new AgentImageInputResolver(catalog.database, store).resolve(
        session.id,
        "/run/attachments/01-fake.png",
      ),
    ).rejects.toThrow("image_format_unsupported");
    catalog.close();
  });
});

describe("agent image size limit", () => {
  it("rejects an oversized attachment before loading its artifact bytes", async () => {
    const { root, catalog, store, conversations } = await fixture();
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

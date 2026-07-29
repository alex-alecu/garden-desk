import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openWorkspaceCatalog } from "../workspace/catalog.js";
import { ConversationStore } from "./store.js";

const roots: string[] = [];

function temporaryRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `vault-${name}-`));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("ConversationStore folder grants", () => {
  it("persists safe folder summaries without exposing host paths", () => {
    const stateRoot = temporaryRoot("state");
    const selectedRoot = join(temporaryRoot("selected"), "client-work");
    mkdirSync(selectedRoot);
    const catalog = openWorkspaceCatalog(stateRoot);
    const store = new ConversationStore(catalog.database);

    const folder = store.addFolder(selectedRoot);
    expect(folder.name).toBe("client-work");
    expect(folder).not.toHaveProperty("rootPath");
    expect(store.resolveFolderPath(folder.id)).toBe(realpathSync.native(selectedRoot));
    catalog.close();

    const reopened = openWorkspaceCatalog(stateRoot);
    expect(new ConversationStore(reopened.database).listFolders()).toEqual([folder]);
    reopened.close();
  });

  it("resolves only active folder grants", () => {
    const stateRoot = temporaryRoot("resolve-state");
    const selectedRoot = temporaryRoot("resolve-selected");
    const catalog = openWorkspaceCatalog(stateRoot);
    const store = new ConversationStore(catalog.database);
    const folder = store.addFolder(selectedRoot);

    expect(store.resolveFolderPath(folder.id)).toBe(realpathSync.native(selectedRoot));
    expect(store.revokeFolder(folder.id)).toBe(true);
    expect(() => store.resolveFolderPath(folder.id)).toThrow("folder_not_found");
    catalog.close();
  });

  it("rejects a symlink as a folder grant", () => {
    const stateRoot = temporaryRoot("symlink-state");
    const selectedRoot = temporaryRoot("symlink-target");
    const link = join(temporaryRoot("symlink-parent"), "linked");
    symlinkSync(selectedRoot, link, "dir");
    const catalog = openWorkspaceCatalog(stateRoot);
    const store = new ConversationStore(catalog.database);

    expect(() => store.addFolder(link)).toThrow("folder_grant_invalid");
    catalog.close();
  });
});

describe("ConversationStore folder ordering", () => {
  it("persists an explicit active-folder order", () => {
    const stateRoot = temporaryRoot("order-state");
    const catalog = openWorkspaceCatalog(stateRoot);
    const store = new ConversationStore(catalog.database);
    const first = store.addFolder(temporaryRoot("order-first"));
    const second = store.addFolder(temporaryRoot("order-second"));
    const third = store.addFolder(temporaryRoot("order-third"));

    expect(store.reorderFolders([third.id, first.id, second.id]).map((item) => item.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    catalog.close();

    const reopened = openWorkspaceCatalog(stateRoot);
    expect(new ConversationStore(reopened.database).listFolders().map((item) => item.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    reopened.close();
  });
});

describe("ConversationStore sessions", () => {
  it("keeps global chats separate and paginates folder sessions", () => {
    const stateRoot = temporaryRoot("sessions");
    const selectedRoot = join(temporaryRoot("selected"), "project");
    mkdirSync(selectedRoot);
    const catalog = openWorkspaceCatalog(stateRoot);
    const store = new ConversationStore(catalog.database);
    const folder = store.addFolder(selectedRoot);
    const sessionIds = new Set<string>();

    for (let index = 0; index < 6; index += 1) {
      const session = store.createSession(folder.id);
      sessionIds.add(session.id);
      store.appendMessage(session.id, "user", `Work item ${index + 1}`);
    }
    const global = store.createSession(null);
    const first = store.listSessions(folder.id);
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    const second = store.listSessions(folder.id, first.nextCursor ?? undefined);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(sessionIds);
    expect(store.listSessions(null).items.map((item) => item.id)).toEqual([global.id]);
    catalog.database
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run("2099-01-01T00:00:00.000Z", global.id);
    expect(store.mostRecentSessionId()).toBe(global.id);
    catalog.close();
  });
});

describe("ConversationStore session deletion", () => {
  it("deletes a conversation and its dependent records", () => {
    const catalog = openWorkspaceCatalog(temporaryRoot("delete-session"));
    const store = new ConversationStore(catalog.database);
    const session = store.createSession(null);
    const now = new Date().toISOString();
    const jobId = "82af7e84-38da-43e2-8f61-3154126ab4e1";
    const runId = "f2359fd9-0f64-4ded-8e14-cb1d25ee5275";
    catalog.database
      .prepare(
        "INSERT INTO jobs (id, kind, idempotency_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(jobId, "agent", "deleted-session", "succeeded", now, now);
    catalog.database
      .prepare(
        "INSERT INTO agent_runs (id, session_id, job_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(runId, session.id, jobId, "succeeded", now, now);
    store.appendMessage(session.id, "user", "Temporary work");
    store.appendMessage(session.id, "assistant", "Temporary result", runId);
    catalog.database
      .prepare("INSERT INTO session_drafts (session_id, content, updated_at) VALUES (?, ?, ?)")
      .run(session.id, "draft", new Date().toISOString());

    expect(store.deleteSession(session.id)).toBe(true);
    expect(store.listSessions(null).items).toEqual([]);
    expect(store.listMessages(session.id)).toEqual([]);
    expect(
      catalog.database.prepare("SELECT 1 FROM session_drafts WHERE session_id = ?").get(session.id),
    ).toBeUndefined();
    expect(
      catalog.database.prepare("SELECT 1 FROM agent_runs WHERE id = ?").get(runId),
    ).toBeUndefined();
    catalog.close();
  });
});

describe("ConversationStore active session deletion", () => {
  it("refuses to delete a running conversation", () => {
    const catalog = openWorkspaceCatalog(temporaryRoot("delete-running-session"));
    const store = new ConversationStore(catalog.database);
    const session = store.createSession(null);
    const now = new Date().toISOString();
    const jobId = "7c2de6fd-c3d7-47a4-a921-a76029e6679c";
    catalog.database
      .prepare(
        "INSERT INTO jobs (id, kind, idempotency_key, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(jobId, "agent", "running-session", "running", now, now);
    catalog.database
      .prepare(
        "INSERT INTO agent_runs (id, session_id, job_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("adf56702-0f6e-4db1-827a-8b817ade5239", session.id, jobId, "running", now, now);

    expect(() => store.deleteSession(session.id)).toThrow("session_busy");
    expect(store.listSessions(null).items).toEqual([session]);
    catalog.close();
  });
});

describe("ConversationStore message validation", () => {
  it("rejects whitespace without corrupting the session title", () => {
    const catalog = openWorkspaceCatalog(temporaryRoot("message"));
    const store = new ConversationStore(catalog.database);
    const session = store.createSession(null);

    expect(() => store.appendMessage(session.id, "user", "   ")).toThrow();
    expect(store.listSessions(null).items[0]?.title).toBe("New chat");
    expect(store.listMessages(session.id)).toEqual([]);
    catalog.close();
  });
});

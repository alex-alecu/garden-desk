import {
  AgentRunSnapshotSchema,
  AttachmentSummarySchema,
  ConversationMessageSchema,
  FolderSummarySchema,
  SessionPageSchema,
  SessionSummarySchema,
} from "@vault/shared";
import { describe, expect, it } from "vitest";
import { desktopReducer, initialDesktopState } from "./state.js";

const timestamp = "2026-07-20T12:00:00.000Z";
const folder = FolderSummarySchema.parse({
  id: "d86a8131-d93a-42e4-8f10-b93b1ff17d28",
  name: "Client files",
  createdAt: timestamp,
});
const firstSession = SessionSummarySchema.parse({
  id: "da911f87-ff26-46d8-9a58-bad222a584ab",
  folderId: folder.id,
  title: "First",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const secondSession = SessionSummarySchema.parse({
  id: "9c79d764-128d-4a75-b04c-4a3739f78d09",
  folderId: folder.id,
  title: "Second",
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("desktop navigation state", () => {
  it("hydrates the persisted five-session folder page", () => {
    const state = desktopReducer(initialDesktopState, {
      type: "desktop.hydrate",
      snapshot: {
        catalogPath: "/tmp/state/.vault/catalog.sqlite",
        folders: [folder],
        globalSessions: { items: [], nextCursor: null },
        folderSessions: [
          {
            folderId: folder.id,
            page: SessionPageSchema.parse({ items: [firstSession], nextCursor: "next" }),
          },
        ],
        model: {
          modelId: "gemma-4-12b-it-qat-q4_0",
          name: "Gemma 4 12B QAT",
          state: "unloaded",
          thinkingSupported: true,
        },
      },
    });
    expect(state.loaded).toBe(true);
    expect(state.catalogPath).toBe("/tmp/state/.vault/catalog.sqlite");
    expect(state.folders[0]?.sessions).toEqual([firstSession]);
    expect(state.folders[0]?.nextCursor).toBe("next");
  });

  it("appends the next persisted page and clears Show more at the end", () => {
    const withFolder = desktopReducer(initialDesktopState, { type: "folder.add", folder });
    const state = desktopReducer(withFolder, {
      type: "folder.page",
      folderId: folder.id,
      page: SessionPageSchema.parse({ items: [secondSession], nextCursor: null }),
    });
    expect(state.folders[0]?.sessions).toEqual([secondSession]);
    expect(state.folders[0]?.nextCursor).toBeNull();
  });
});

describe("blank and deleted desktop sessions", () => {
  it("does not persist repeated blank New chat actions", () => {
    const first = desktopReducer(initialDesktopState, { type: "session.new", folderId: null });
    const repeated = desktopReducer(first, { type: "session.new", folderId: null });
    expect(repeated.activeSessionId).toBeUndefined();
    expect(repeated.newSessionFolderId).toBeNull();
    expect(repeated.globalSessions).toEqual([]);
  });

  it("prepares a folder context without adding an empty session row", () => {
    const withFolder = desktopReducer(initialDesktopState, { type: "folder.add", folder });
    const state = desktopReducer(withFolder, { type: "session.new", folderId: folder.id });
    expect(state.activeSessionId).toBeUndefined();
    expect(state.newSessionFolderId).toBe(folder.id);
    expect(state.folders[0]?.sessions).toEqual([]);
  });

  it("removes a deleted conversation and clears it when selected", () => {
    const withFolder = desktopReducer(initialDesktopState, { type: "folder.add", folder });
    const selected = desktopReducer(withFolder, {
      type: "session.created",
      session: firstSession,
    });
    const state = desktopReducer(selected, {
      type: "session.deleted",
      sessionId: firstSession.id,
    });
    expect(state.folders[0]?.sessions).toEqual([]);
    expect(state.activeSessionId).toBeUndefined();
    expect(state.newSessionFolderId).toBeNull();
  });
});

describe("global desktop sessions", () => {
  it("keeps New chat outside a folder", () => {
    const globalSession = SessionSummarySchema.parse({
      ...firstSession,
      id: "33899065-80f4-4515-a35f-07d37391a6ae",
      folderId: null,
    });
    const state = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: globalSession,
    });
    expect(state.activeSessionId).toBe(globalSession.id);
    expect(state.globalSessions).toEqual([globalSession]);
  });

  it("updates the first-message title of a restored New chat", () => {
    const globalSession = SessionSummarySchema.parse({
      ...firstSession,
      id: "33899065-80f4-4515-a35f-07d37391a6ae",
      folderId: null,
      title: "New chat",
    });
    const withSession = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: globalSession,
    });
    const state = desktopReducer(withSession, {
      type: "message.append",
      message: ConversationMessageSchema.parse({
        id: "f7c90f8d-3792-4d6e-834f-cf5fa46fa6ec",
        sessionId: globalSession.id,
        role: "user",
        content: "Restore this conversation",
        createdAt: timestamp,
      }),
    });
    expect(state.globalSessions[0]?.title).toBe("Restore this conversation");
  });
});

describe("background agent updates", () => {
  it("does not mix an old session run into the selected conversation", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: secondSession,
    });
    const snapshot = AgentRunSnapshotSchema.parse({
      run: {
        id: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
        sessionId: firstSession.id,
        jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
        state: "running",
        response: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      events: [],
      artifacts: [],
    });
    expect(desktopReducer(selected, { type: "agent.snapshot", snapshot })).toBe(selected);
  });
});

describe("agent activity presentation", () => {
  it("keeps activity details bounded and separate from the summary", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: firstSession,
    });
    const snapshot = AgentRunSnapshotSchema.parse({
      run: {
        id: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
        sessionId: firstSession.id,
        jobId: "ea31a359-3b01-4d54-9950-e3d46e807381",
        state: "running",
        response: null,
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      events: [
        {
          id: "d59ff233-f216-4ee7-a156-a5a1c6cb5ed1",
          runId: "77ff5b22-555d-4ef2-9170-fdd7118738f1",
          sequence: 0,
          type: "execution.completed",
          summary: "Python completed.",
          language: "python",
          path: "steps/0001.py",
          source: "print('ok')",
          command: null,
          stdout: "x".repeat(25_000),
          stderr: "",
          termination: "completed",
          createdAt: timestamp,
        },
      ],
      artifacts: [],
    });
    const state = desktopReducer(selected, { type: "agent.snapshot", snapshot });
    expect(state.timeline[0]?.text).toBe("Python completed.");
    expect(state.timeline[0]?.eventType).toBe("execution.completed");
    expect(state.timeline[0]?.createdAt).toBe(timestamp);
    expect(state.timeline[0]?.detail).not.toContain("Code:");
    expect(state.timeline[0]?.detail).toContain("… output truncated");
    expect(state.timeline[0]?.detail?.length).toBeLessThan(21_000);
  });
});

describe("desktop attachment and draft state", () => {
  it("removes only the selected pending attachment", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: firstSession,
    });
    const attachment = AttachmentSummarySchema.parse({
      id: "6712ff10-f0d1-4cdc-8bbc-25097c29da35",
      sessionId: firstSession.id,
      name: "notes.txt",
      mediaType: "text/plain",
      byteLength: 5,
      contentHash: `sha256:${"a".repeat(64)}`,
      createdAt: timestamp,
    });
    const loaded = desktopReducer(selected, {
      type: "attachments.load",
      sessionId: firstSession.id,
      attachments: [attachment],
      removableIds: [attachment.id],
    });
    const removed = desktopReducer(loaded, {
      type: "attachment.remove",
      attachmentId: attachment.id,
    });
    expect(removed.attachments).toEqual([]);
    expect(removed.removableAttachmentIds).toEqual([]);
  });

  it("does not overwrite text entered while a saved draft loads", () => {
    const selected = desktopReducer(initialDesktopState, {
      type: "session.created",
      session: firstSession,
    });
    const typed = desktopReducer(selected, { type: "draft.change", draft: "new text" });
    const loaded = desktopReducer(typed, {
      type: "draft.load",
      sessionId: firstSession.id,
      draft: "older saved text",
    });
    expect(loaded.draft).toBe("new text");
  });
});

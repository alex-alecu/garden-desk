import {
  AttachmentSummarySchema,
  FolderSummarySchema,
  SessionDraftSchema,
  SessionSummarySchema,
} from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "./api.js";
import { addDroppedFolders, attach } from "./desktop-actions.js";
import type { DesktopAction } from "./state.js";

const session = SessionSummarySchema.parse({
  id: "33fecbc1-d68f-4aca-821f-ac03b204773f",
  folderId: null,
  title: "New chat",
  createdAt: "2026-07-28T12:03:34.813Z",
  updatedAt: "2026-07-28T12:03:34.813Z",
});
const attachment = AttachmentSummarySchema.parse({
  id: "1c328078-e21a-4b3a-bdac-94761e7d0b8a",
  sessionId: session.id,
  name: "contract.pdf",
  mediaType: "application/pdf",
  byteLength: 42,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: "2026-07-28T12:03:38.909Z",
});
const folder = FolderSummarySchema.parse({
  id: "d86a8131-d93a-42e4-8f10-b93b1ff17d28",
  name: "Client files",
  createdAt: "2026-07-28T12:03:34.813Z",
});
const secondFolder = FolderSummarySchema.parse({
  id: "017b8017-6372-40dd-9f44-a09c70ae921f",
  name: "Research",
  createdAt: "2026-07-28T12:03:35.813Z",
});

describe("desktop folder actions", () => {
  it("opens a new conversation in the last dropped folder", async () => {
    const actions: DesktopAction[] = [];
    const api = {
      addFolders: vi.fn(async () => [folder, secondFolder]),
    } as unknown as DesktopApi;

    await addDroppedFolders(
      api,
      ["/Users/alex/Documents/Client files"],
      (action) => actions.push(action),
      () => undefined,
    );

    expect(actions).toEqual([
      { type: "folder.add", folder },
      { type: "folder.add", folder: secondFolder },
      { type: "session.new", folderId: secondFolder.id },
    ]);
  });
});

describe("desktop attachment actions", () => {
  it("preserves and saves a new-chat draft before opening the file picker", async () => {
    const actions: DesktopAction[] = [];
    const saveDraft = vi.fn(async (sessionId: string, content: string) =>
      SessionDraftSchema.parse({ sessionId, content, updatedAt: session.updatedAt }),
    );
    const api = {
      createSession: vi.fn(async () => session),
      saveDraft,
      chooseFiles: vi.fn(async () => [attachment]),
    } as unknown as DesktopApi;

    await attach({
      api,
      activeSessionId: undefined,
      newSessionFolderId: null,
      dispatch: (action) => actions.push(action),
      draft: "Review this contract",
      setError: () => undefined,
    });

    expect(saveDraft).toHaveBeenCalledWith(session.id, "Review this contract");
    expect(actions.map((action) => action.type)).toEqual([
      "session.created",
      "draft.change",
      "attachments.add",
    ]);
  });
});

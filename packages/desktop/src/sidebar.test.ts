import { FolderSummarySchema, SessionSummarySchema } from "@vault/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { reorderedFolderIds, Sidebar } from "./components/sidebar.js";

const timestamp = "2026-07-22T10:00:00.000Z";
const folder = FolderSummarySchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Project",
  createdAt: timestamp,
  revokedAt: null,
});
const globalSession = SessionSummarySchema.parse({
  id: "00000000-0000-4000-8000-000000000002",
  folderId: null,
  title: "Global chat",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const folderSession = SessionSummarySchema.parse({
  id: "00000000-0000-4000-8000-000000000003",
  folderId: folder.id,
  title: "Folder chat",
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("sidebar rows", () => {
  it("uses the same row controls for chats and folders, with an icon only on folders", () => {
    const markup = renderToStaticMarkup(
      createElement(Sidebar, {
        activeSessionId: globalSession.id,
        disabled: false,
        dispatch: () => undefined,
        folders: [{ ...folder, expanded: true, nextCursor: null, sessions: [folderSession] }],
        globalSessions: [globalSession],
        workingSessionIds: [folderSession.id],
        onAddFolder: () => undefined,
        onNewSession: () => undefined,
        onOpenFolder: () => undefined,
        onDeleteSession: () => undefined,
        onRevokeFolder: () => undefined,
        onReorderFolders: () => undefined,
        onSelectSession: () => undefined,
        onShowMore: () => undefined,
      }),
    );

    expect(
      markup.match(
        /class="sidebar-item-row(?: sidebar-item-row-with-start)?(?: sidebar-item-row-with-drag)?"/gu,
      ),
    ).toHaveLength(3);
    expect(markup.match(/class="sidebar-item-delete(?: sidebar-item-unmount)?"/gu)).toHaveLength(3);
    expect(markup.match(/class="sidebar-item-start"/gu)).toHaveLength(1);
    expect(markup.match(/icon-folder/gu)).toHaveLength(1);
    expect(markup.match(/icon-drag/gu)).toHaveLength(1);
    expect(markup.match(/icon-message/gu)).toHaveLength(2);
    expect(markup.match(/icon-trash/gu)).toHaveLength(2);
    expect(markup.match(/icon-unmount/gu)).toHaveLength(1);
    expect(markup).toContain("Add folder");
    expect(markup).toContain('aria-label="Open Project folder"');
    expect(markup).toContain('aria-label="Unmount Project"');
    expect(markup).toContain('class="sidebar-item-delete sidebar-item-unmount"');
    expect(markup).not.toContain("icon-chevron");
    expect(markup).toContain('class="sidebar-item-select sidebar-item-working"');
    expect(markup).toContain('aria-label="Working"');
  });

  it("moves a dragged folder before or after its target", () => {
    expect(reorderedFolderIds(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(reorderedFolderIds(["a", "b", "c"], "a", "b", true)).toEqual(["b", "a", "c"]);
  });
});

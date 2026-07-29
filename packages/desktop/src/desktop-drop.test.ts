import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopApi } from "./api.js";
import { DropOverlay } from "./components/drop-overlay.js";
import { handleNativeDrop, intentForDroppedPaths, type NativeDropOptions } from "./desktop-drop.js";

describe("native desktop drop presentation", () => {
  it("routes dropped paths by filesystem kind", () => {
    expect(intentForDroppedPaths({ files: ["/tmp/a.pdf"], folders: [] })).toBe("files");
    expect(intentForDroppedPaths({ files: [], folders: ["/tmp/work"] })).toBe("folders");
    expect(intentForDroppedPaths({ files: ["/tmp/a.pdf"], folders: ["/tmp/work"] })).toBe("mixed");
    expect(intentForDroppedPaths({ files: [], folders: [] })).toBeUndefined();
  });

  it.each([
    ["checking", "Drop files or folders"],
    ["files", "Drop files to attach"],
    ["folders", "Drop folders to add workspaces"],
    ["mixed", "Drop to add files and folders"],
  ] as const)("shows the %s whole-window affordance", (intent, label) => {
    const markup = renderToStaticMarkup(createElement(DropOverlay, { intent }));
    expect(markup).toContain(label);
    expect(markup).toContain("Release anywhere");
  });

  it("imports a mixed drop anywhere in the window", async () => {
    const calls: string[] = [];
    const api = {
      classifyDroppedPaths: async () => ({ files: ["/tmp/a.pdf"], folders: ["/tmp/work"] }),
      addFolders: async () => {
        calls.push("folders");
        return [];
      },
      saveDraft: async () => {
        calls.push("draft");
        return {};
      },
      addFiles: async () => {
        calls.push("files");
        return [];
      },
    } as unknown as DesktopApi;
    const options: NativeDropOptions = {
      api,
      context: {
        activeSessionId: "33fecbc1-d68f-4aca-821f-ac03b204773f",
        draft: "Review these",
        newSessionFolderId: null,
        running: false,
      },
      dispatch: () => undefined,
      setDropIntent: () => undefined,
      setError: () => undefined,
    };

    await handleNativeDrop({ type: "drop", paths: ["/tmp/a.pdf", "/tmp/work"] }, options, {
      current: 0,
    });

    expect(calls).toEqual(["folders", "draft", "files"]);
  });
});

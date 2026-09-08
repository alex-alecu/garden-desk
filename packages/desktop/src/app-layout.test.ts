import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopApi } from "./api.js";
import { App } from "./app.js";
import { initialDesktopState } from "./state.js";

const props = {
  api: {} as DesktopApi,
  capabilities: { nativeActions: true },
};

describe("desktop window layout", () => {
  it("keeps distinct chat section keys after attaching a file creates a session", () => {
    const previousSession = initialDesktopState.activeSessionId;
    initialDesktopState.activeSessionId = "attached-file-session";
    function InspectLayout() {
      const tree = App(props);
      const children = tree.props.children as ReactElement<{ children: ReactNode[] }>[];
      const main = children.find((child) => child.type === "main");
      const keys = main?.props.children
        .filter(isValidElement)
        .map((child) => child.key)
        .filter((key) => key !== null);
      expect(keys).toBeDefined();
      expect(new Set(keys).size).toBe(keys?.length);
      return tree;
    }
    try {
      renderToStaticMarkup(createElement(InspectLayout));
    } finally {
      initialDesktopState.activeSessionId = previousSession;
    }
  });

  it("keeps the title-bar spans and visible chat header draggable", () => {
    const markup = renderToStaticMarkup(createElement(App, props));

    expect(markup).toMatch(/<aside[^>]*class="sidebar"[^>]*>\s*<div[^>]*data-tauri-drag-region/);
    expect(markup).toMatch(/<main[^>]*class="workspace"[^>]*>\s*<div[^>]*data-tauri-drag-region/);
    expect(markup).toMatch(/<header[^>]*class="chat-header"[^>]*data-tauri-drag-region/);
  });

  it("places creation actions first in their sidebar sections", () => {
    const markup = renderToStaticMarkup(createElement(App, props));

    expect(markup).toMatch(/>Chats<\/h2>.*>New chat<\/button>.*global-session-list/s);
    expect(markup).toMatch(/>Folders<\/h2>.*>Add folder<\/button>.*folder-scroll/s);
  });

  it("keeps model identity and runtime controls in the chat header", () => {
    const markup = renderToStaticMarkup(createElement(App, props));

    expect(markup).toContain("Qwen3.8 27B Q4");
    expect(markup).not.toContain("Thinking on");
    expect(markup).not.toContain(">G4<");
    expect(markup).toMatch(
      /<button[^>]*class="header-action unload-action"[^>]*>.*Unload.*<button[^>]*class="header-action appearance-action"[^>]*>.*<button[^>]*class="header-action technical-details-action"/s,
    );
    expect(markup).toContain('data-appearance="system"');
    expect(markup).toContain('data-theme="light"');
  });

  it("exposes the navigation divider as a full-height resize separator", () => {
    const markup = renderToStaticMarkup(createElement(App, props));

    expect(markup).toContain('<hr aria-label="Resize navigation sidebar"');
    expect(markup).toContain('aria-label="Resize navigation sidebar"');
  });
});

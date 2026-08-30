import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Conversation } from "./components/conversation.js";

const emptyConversation = {
  artifacts: [],
  onSuggestion: () => undefined,
  performance: null,
  ready: true,
  runId: undefined,
  timeline: [],
};

describe("empty conversation context", () => {
  it("shows the folder name for a folder conversation", () => {
    const markup = renderToStaticMarkup(
      createElement(Conversation, { ...emptyConversation, folderName: "Project files" }),
    );

    expect(markup).toMatch(/What should we work on in\s*<span[^>]*>Project files\/<\/span>\?/);
    expect(markup).not.toContain("welcome-context");
  });

  it("shows no context label for a global chat", () => {
    const markup = renderToStaticMarkup(createElement(Conversation, emptyConversation));

    expect(markup).toContain("What should we work on?");
    expect(markup).not.toContain("What should we work on in");
  });
});

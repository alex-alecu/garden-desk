import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Conversation } from "./components/conversation.js";
import { stableStreamingMarkdown } from "./streaming-markdown.js";

describe("streaming Markdown presentation", () => {
  it("keeps partial Markdown safe and hides unfinished response controls", () => {
    expect(stableStreamingMarkdown("Working\n\n-")).toBe("Working\n");
    expect(stableStreamingMarkdown("## Result\n\nStill streaming")).toBe(
      "## Result\n\nStill streaming",
    );
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        ready: true,
        timeline: [
          { createdAt: "2026-08-14T17:00:00.000Z", id: "user", kind: "user", text: "Stream it" },
          {
            createdAt: "2026-08-14T17:00:01.000Z",
            id: "streaming-response",
            kind: "assistant",
            text: "## Result\n\nStill streaming\n\n```ts\nconst ready = true;",
            runId: "run",
            streaming: true,
          },
        ],
        onSuggestion: () => undefined,
        performance: null,
        runId: "run",
        working: true,
      }),
    );

    expect(markup).toContain("<h2>Result</h2>");
    expect(markup).toContain('class="assistant-markdown assistant-markdown-streaming"');
    expect(markup).toContain("const ready = true;");
    expect(markup).not.toContain("Copy response");
  });
});

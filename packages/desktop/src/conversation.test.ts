import { AgentArtifactSummarySchema } from "@vault/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Conversation, isNearConversationBottom } from "./components/conversation.js";
import type { TimelineItem } from "./state.js";

const timestamp = "2026-07-20T12:00:00.000Z";
const runId = "77ff5b22-555d-4ef2-9170-fdd7118738f1";
const generatedReport = AgentArtifactSummarySchema.parse({
  id: "6ad824dc-bd7a-431a-9b2a-e79cdb8a98fe",
  runId,
  name: "report.csv",
  mediaType: "text/csv",
  byteLength: 42,
  contentHash: `sha256:${"a".repeat(64)}`,
  createdAt: "2026-07-20T12:00:05.000Z",
});
const restoredActivity = [
  { createdAt: timestamp, id: "user", kind: "user", text: "Build a report" },
  {
    createdAt: "2026-07-20T12:00:06.000Z",
    id: "assistant",
    kind: "assistant",
    text: "The report is ready.",
    runId,
  },
  {
    createdAt: "2026-07-20T12:00:01.000Z",
    eventType: "run.started",
    id: "limits",
    kind: "activity",
    runId,
    text: "Offline limits: 4 CPUs, 4 GiB memory.",
  },
  {
    createdAt: "2026-07-20T12:00:02.000Z",
    eventType: "inference.started",
    id: "planning",
    kind: "activity",
    runId,
    text: "Loading the local model and planning the task.",
  },
  {
    createdAt: "2026-07-20T12:00:03.000Z",
    detail: "Code:\nprint('secret')",
    eventType: "execution.started",
    id: "execute",
    kind: "activity",
    runId,
    text: "Inspecting the selected data.",
  },
  {
    createdAt: "2026-07-20T12:00:04.000Z",
    detail: "Output:\nsecret output\n\nTermination: completed",
    eventType: "execution.completed",
    id: "completed",
    kind: "activity",
    runId,
    text: "Finished this step.",
  },
  {
    createdAt: "2026-07-20T12:00:05.500Z",
    eventType: "assistant.completed",
    id: "response-completed",
    kind: "activity",
    runId,
    text: "Response completed.",
  },
] satisfies TimelineItem[];

function renderRestoredActivity(): string {
  return renderToStaticMarkup(
    createElement(Conversation, {
      artifacts: [generatedReport],
      ready: true,
      timeline: restoredActivity,
      onSuggestion: () => undefined,
      performance: null,
      runId,
      thinking: null,
    }),
  );
}

describe("empty conversation presentation", () => {
  it("includes folder context in the prompt and offers a review task", () => {
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        folderName: "Client files",
        ready: true,
        timeline: [],
        onSuggestion: () => undefined,
        performance: null,
        runId: undefined,
        thinking: null,
      }),
    );

    expect(markup).toContain("What should we work on in Client files?");
    expect(markup).not.toContain("welcome-context");
    expect(markup).toContain("Review and suggest improvements");
    expect(markup).not.toContain("Build a small artifact");
  });
});

describe("conversation scrolling", () => {
  it("follows updates only while the reader remains near the latest message", () => {
    expect(isNearConversationBottom(952, 1_000, 2_000)).toBe(true);
    expect(isNearConversationBottom(400, 1_000, 2_000)).toBe(false);
  });

  it("makes the full conversation pane the scroll container", () => {
    const markup = renderRestoredActivity();

    expect(markup).toMatch(
      /<section[^>]*class="conversation-scroll"[^>]*>\s*<div class="timeline">/,
    );
  });
});

describe("conversation performance presentation", () => {
  it("shows live thinking and metrics only beneath the latest assistant response", () => {
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        ready: true,
        timeline: [
          { createdAt: timestamp, id: "user", kind: "user", text: "Hello" },
          {
            createdAt: "2026-07-20T12:00:01.000Z",
            id: "assistant",
            kind: "assistant",
            text: "Hi",
            runId: "run",
          },
        ],
        onSuggestion: () => undefined,
        performance: {
          promptTokens: 200,
          outputTokens: 50,
          tokensPerSecond: 12.34,
          promptTokensPerSecond: 98.76,
          totalDurationMs: 4_250,
        },
        runId: "run",
        thinking: "I am checking the local context.",
      }),
    );

    expect(markup).toContain("12.3</strong> generation tok/s");
    expect(markup).toContain("98.8</strong> prompt tok/s");
    expect(markup).toMatch(
      /98.8<\/strong> prompt tok\/s.*12.3<\/strong> generation tok\/s.*4.3s<\/strong> total/s,
    );
    expect(markup).toContain("4.3s</strong> total");
    expect(markup).toContain("Thinking locally");
    expect(markup).toContain("I am checking the local context.");
  });
});

describe("conversation Markdown presentation", () => {
  it("renders safe assistant GFM without interpreting user Markdown or active content", () => {
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        ready: true,
        timeline: [
          { createdAt: timestamp, id: "user", kind: "user", text: "## Keep this literal" },
          {
            createdAt: "2026-07-20T12:00:01.000Z",
            id: "assistant",
            kind: "assistant",
            text: "## Result\n\n| Item | Status |\n| --- | --- |\n| Report | **Ready** |\n\n- [x] Verified\n  - Nested evidence\n\n- [ ] Follow up\n\n  Second paragraph\n\n~~Draft~~ Final\n\n[Reference](https://example.test/page)\n\nhttps://example.test/auto\n\n![remote](https://example.test/image.png)\n\n<script>alert('no')</script>",
            runId: "run",
          },
        ],
        onSuggestion: () => undefined,
        performance: null,
        runId: "run",
        thinking: null,
      }),
    );

    expect(markup).toContain("<p>## Keep this literal</p>");
    expect(markup).toContain("<h2>Result</h2>");
    expect(markup).toContain('aria-label="Response table"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain("<table>");
    expect(markup).toContain("<th>Item</th>");
    expect(markup).toContain("<td><strong>Ready</strong></td>");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("disabled");
    expect(markup).toContain("<li>Nested evidence</li>");
    expect(markup).toContain("<p>Second paragraph</p>");
    expect(markup).toContain("<del>Draft</del> Final");
    expect(markup).toContain("<p>Reference</p>");
    expect(markup).toContain("https://example.test/auto");
    expect(markup).not.toMatch(/<a(?:\s|>)/u);
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("https://example.test/image.png");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("alert");
  });
});

describe("conversation activity presentation", () => {
  it("groups restored generated files after the response and before metrics", () => {
    const markup = renderRestoredActivity();

    const orderedText = [
      "Build a report",
      "Loading the local model",
      "Inspecting the selected data",
      "Finished this step",
      "The report is ready",
      "Generated files",
      "report.csv",
    ];
    expect(orderedText.map((text) => markup.indexOf(text))).toEqual(
      [...orderedText.map((text) => markup.indexOf(text))].sort((left, right) => left - right),
    );
    expect(markup).not.toContain("Offline limits");
    expect(markup).not.toContain("Response completed");
    expect(markup).not.toContain("secret output");
    expect(markup).not.toContain("print(&#x27;secret&#x27;)");
    expect(markup).toContain('aria-label="Open report.csv"');
    expect(markup).toContain('aria-label="Save report.csv as"');
    expect(markup).toContain("Save As…");
  });

  it("keeps the current action and completed execution count visible while working", () => {
    const timeline = restoredActivity.filter((item) => item.id !== "response-completed");
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        ready: true,
        timeline,
        onSuggestion: () => undefined,
        performance: null,
        runId,
        thinking: null,
        working: true,
      }),
    );

    expect(markup).toContain("Working locally");
    expect(markup).toContain("Finished this step.");
    expect(markup).toContain("1 execution completed");
  });
});

describe("conversation step selection", () => {
  it("exposes each activity step as a labelled button and marks the selected one", () => {
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        ready: true,
        timeline: restoredActivity,
        onSuggestion: () => undefined,
        onSelectStep: () => undefined,
        selectedStepId: "completed",
        performance: null,
        runId,
        thinking: null,
      }),
    );

    expect(markup).toContain('class="activity-step"');
    expect(markup).toContain('aria-label="Show technical details for: Finished this step.');
    expect(markup).toContain('aria-current="step"');
  });
});

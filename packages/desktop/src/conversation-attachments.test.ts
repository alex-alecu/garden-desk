import { AttachmentSummarySchema } from "@vault/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Conversation } from "./components/conversation.js";

describe("conversation attachment presentation", () => {
  it("shows a submitted attachment beneath its user message as an open action", () => {
    const attachment = AttachmentSummarySchema.parse({
      id: "b6b7467e-6811-4cd1-87d3-99812f6432d6",
      sessionId: "9dbb56fd-c75a-4749-9d74-5b8ef084a6de",
      name: "contract.pdf",
      mediaType: "application/pdf",
      byteLength: 42,
      contentHash: `sha256:${"b".repeat(64)}`,
      createdAt: "2026-07-20T11:59:59.000Z",
    });
    const markup = renderToStaticMarkup(
      createElement(Conversation, {
        artifacts: [],
        attachments: [attachment],
        ready: true,
        timeline: [
          { createdAt: "2026-07-20T12:00:00.000Z", id: "user", kind: "user", text: "Review it" },
        ],
        onOpenAttachment: () => undefined,
        onSuggestion: () => undefined,
        performance: null,
        runId: undefined,
        thinking: null,
      }),
    );

    expect(markup).toMatch(/Review it.*Message attachments.*Open contract\.pdf/s);
    expect(markup).toContain(">contract.pdf</button>");
  });
});

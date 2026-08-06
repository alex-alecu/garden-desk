import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { copyUserMessage, formatMessageTime, UserMessage } from "./components/user-message.js";

const timestamp = "2026-07-20T12:00:00.000Z";

describe("user message actions", () => {
  it("exposes the persisted message time and copy action", () => {
    const markup = renderToStaticMarkup(
      <UserMessage
        attachments={[]}
        item={{ createdAt: timestamp, id: "user", kind: "user", text: "Build a report" }}
        onOpenAttachment={() => undefined}
      />,
    );

    expect(markup).toContain(
      `<time dateTime="${timestamp}">${formatMessageTime(timestamp)}</time>`,
    );
    expect(markup).toContain('aria-label="Copy message"');
    expect(markup).toContain('class="icon icon-copy"');
  });

  it("copies only the exact selected user message", async () => {
    const copied: string[] = [];

    await copyUserMessage("Keep\nthis exact text", {
      async writeText(text) {
        copied.push(text);
      },
    });

    expect(copied).toEqual(["Keep\nthis exact text"]);
  });
});

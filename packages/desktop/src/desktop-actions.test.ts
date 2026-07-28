import { AttachmentSummarySchema, SessionDraftSchema, SessionSummarySchema } from "@vault/shared";
import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "./api.js";
import { attach } from "./desktop-actions.js";
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

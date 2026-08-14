import { ConversationMessageSchema, SessionSummarySchema } from "@vault/shared";
import { describe, expect, it } from "vitest";
import { desktopReducer, initialDesktopState } from "./state.js";

const timestamp = "2026-07-20T12:00:00.000Z";
const firstSession = SessionSummarySchema.parse({
  id: "da911f87-ff26-46d8-9a58-bad222a584ab",
  folderId: null,
  title: "First",
  createdAt: timestamp,
  updatedAt: timestamp,
});
const secondSession = SessionSummarySchema.parse({
  ...firstSession,
  id: "9c79d764-128d-4a75-b04c-4a3739f78d09",
  title: "Second",
});

describe("desktop session selection", () => {
  it("keeps the current conversation until the selected session is ready", () => {
    const current = desktopReducer(
      desktopReducer(initialDesktopState, { type: "session.created", session: firstSession }),
      {
        type: "messages.load",
        sessionId: firstSession.id,
        messages: [
          ConversationMessageSchema.parse({
            id: "f7c90f8d-3792-4d6e-834f-cf5fa46fa6ec",
            sessionId: firstSession.id,
            role: "user",
            content: "Keep this visible",
            createdAt: timestamp,
          }),
        ],
      },
    );

    const loading = desktopReducer(current, {
      type: "session.select",
      sessionId: secondSession.id,
    });
    expect(loading.activeSessionId).toBe(firstSession.id);
    expect(loading.pendingSessionId).toBe(secondSession.id);
    expect(loading.timeline[0]?.text).toBe("Keep this visible");

    const loaded = desktopReducer(loading, {
      type: "session.loaded",
      sessionId: secondSession.id,
      messages: [],
      attachments: [],
      removableIds: [],
      draft: "",
      snapshots: [],
    });
    expect(loaded.activeSessionId).toBe(secondSession.id);
    expect(loaded.pendingSessionId).toBeUndefined();
    expect(loaded.timeline).toEqual([]);
  });
});

describe("concurrent desktop session selection", () => {
  it("ignores an earlier session response after a newer selection", () => {
    const firstSelection = desktopReducer(initialDesktopState, {
      type: "session.select",
      sessionId: firstSession.id,
    });
    const latestSelection = desktopReducer(firstSelection, {
      type: "session.select",
      sessionId: secondSession.id,
    });
    const staleResponse = desktopReducer(latestSelection, {
      type: "session.loaded",
      sessionId: firstSession.id,
      messages: [],
      attachments: [],
      removableIds: [],
      draft: "",
      snapshots: [],
    });

    expect(staleResponse.activeSessionId).toBeUndefined();
    expect(staleResponse.pendingSessionId).toBe(secondSession.id);
  });
});

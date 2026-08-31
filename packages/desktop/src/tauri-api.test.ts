import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { tauriDesktopApi } from "./tauri-api.js";

describe("Tauri desktop API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a bootstrap validation failure before it rethrows it", async () => {
    invoke.mockResolvedValueOnce({});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const failure = await tauriDesktopApi.bootstrapDesktop().catch((error: unknown) => error);

    expect(failure).toEqual(new Error("Invalid catalog path."));
    expect(consoleError).toHaveBeenCalledWith("[desktop:desktop_bootstrap]", failure);
    expect(consoleError.mock.calls[0]?.[1]).toBe(failure);
  });
});

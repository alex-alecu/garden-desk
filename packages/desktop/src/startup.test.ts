import { describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "./api.js";
import { desktopBootstrapRequest } from "./startup.js";

describe("desktop startup", () => {
  it("shares one bootstrap request across a development effect replay", () => {
    const api = { bootstrapDesktop: vi.fn(() => new Promise(() => {})) } as unknown as DesktopApi;

    const first = desktopBootstrapRequest(api);
    const replay = desktopBootstrapRequest(api, first);

    expect(replay).toBe(first);
    expect(api.bootstrapDesktop).toHaveBeenCalledOnce();
  });

  it("starts a new request when the desktop API changes", () => {
    const firstApi = {
      bootstrapDesktop: vi.fn(() => new Promise(() => {})),
    } as unknown as DesktopApi;
    const nextApi = {
      bootstrapDesktop: vi.fn(() => new Promise(() => {})),
    } as unknown as DesktopApi;

    const first = desktopBootstrapRequest(firstApi);
    const next = desktopBootstrapRequest(nextApi, first);

    expect(next).not.toBe(first);
    expect(nextApi.bootstrapDesktop).toHaveBeenCalledOnce();
  });
});

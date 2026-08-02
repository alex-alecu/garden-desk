import { describe, expect, it, vi } from "vitest";
import { hasWindowsDevelopmentAuthority } from "./windows-dev-elevation.js";

describe("Windows desktop development authority", () => {
  it("does not require a Windows token on another platform", () => {
    const spawn = vi.fn();
    expect(hasWindowsDevelopmentAuthority("darwin", spawn)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("accepts only an administrator Windows token", () => {
    const administrator = vi.fn(() => ({ error: undefined, status: 0 }) as never);
    const standardUser = vi.fn(() => ({ error: undefined, status: 1 }) as never);

    expect(hasWindowsDevelopmentAuthority("win32", administrator)).toBe(true);
    expect(hasWindowsDevelopmentAuthority("win32", standardUser)).toBe(false);
    expect(administrator).toHaveBeenCalledOnce();
    expect(standardUser).toHaveBeenCalledOnce();
  });
});

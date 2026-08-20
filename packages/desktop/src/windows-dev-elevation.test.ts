import { describe, expect, it, vi } from "vitest";
import { hasWindowsStandardUserAuthority } from "./windows-dev-elevation.js";

describe("Windows desktop development authority", () => {
  it("does not require a Windows token on another platform", () => {
    const spawn = vi.fn();
    expect(hasWindowsStandardUserAuthority("darwin", spawn)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("accepts only a standard-user Windows token", () => {
    const administrator = vi.fn(() => ({ error: undefined, status: 0 }) as never);
    const standardUser = vi.fn(() => ({ error: undefined, status: 1 }) as never);

    expect(hasWindowsStandardUserAuthority("win32", administrator)).toBe(false);
    expect(hasWindowsStandardUserAuthority("win32", standardUser)).toBe(true);
    expect(administrator).toHaveBeenCalledOnce();
    expect(standardUser).toHaveBeenCalledOnce();
  });
});

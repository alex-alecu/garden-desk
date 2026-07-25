import { describe, expect, it } from "vitest";
import { nextAppearance, resolveAppearance } from "./appearance.js";

describe("appearance preference", () => {
  it("cycles through system, light, and dark", () => {
    expect(nextAppearance("system")).toBe("light");
    expect(nextAppearance("light")).toBe("dark");
    expect(nextAppearance("dark")).toBe("system");
  });

  it("follows the operating system only in system mode", () => {
    expect(resolveAppearance("system", false)).toBe("light");
    expect(resolveAppearance("system", true)).toBe("dark");
    expect(resolveAppearance("light", true)).toBe("light");
    expect(resolveAppearance("dark", false)).toBe("dark");
  });
});

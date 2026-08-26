import { describe, expect, it } from "vitest";
import { runHostPython } from "./artifact-text.js";

describe("host artifact Python", () => {
  it("returns UTF-8 text on macOS and Windows without generated libraries", async () => {
    await expect(runHostPython("print(chr(0x25A0))", [], [])).resolves.toContain("■");
  });
});

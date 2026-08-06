import { describe, expect, it } from "vitest";
import {
  CHAT_MIN_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  maximumDrawerWidth,
} from "./components/drawer-resize.js";

describe("technical details resize boundary", () => {
  it("preserves the chat header minimum before reaching the absolute drawer maximum", () => {
    expect(maximumDrawerWidth(1_000)).toBe(1_000 - CHAT_MIN_WIDTH);
    expect(maximumDrawerWidth(2_000)).toBe(DRAWER_MAX_WIDTH);
    expect(maximumDrawerWidth(600)).toBe(DRAWER_MIN_WIDTH);
  });
});

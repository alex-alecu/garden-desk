import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

describe("M0 native dependency load smoke", () => {
  it("loads the pinned SQLite binding", () => {
    const database = new Database(":memory:");
    try {
      const row = database.prepare("select 1 as value").get() as { value: number };
      expect(row.value).toBe(1);
    } finally {
      database.close();
    }
  });
});

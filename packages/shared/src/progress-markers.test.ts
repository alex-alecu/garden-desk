import { describe, expect, it } from "vitest";
import { parseWorkProgress, stripWorkProgress, workProgressAdvanced } from "./progress-markers.js";

describe("generic progress evidence", () => {
  it("parses valid progress and removes only reserved markers", () => {
    const stdout = [
      "RESULT=10",
      "VAULT_PROGRESS_DONE=2",
      "VAULT_PROGRESS_TOTAL=5",
      "VAULT_PROGRESS_COMPLETE=0",
    ].join("\n");
    expect(parseWorkProgress(stdout)).toEqual({ done: 2, total: 5, complete: false });
    expect(stripWorkProgress(stdout)).toBe("RESULT=10");
  });

  it("accepts whitespace-delimited markers on one line", () => {
    const stdout = [
      "No matching records found.",
      "VAULT_PROGRESS_DONE=36 VAULT_PROGRESS_TOTAL=36 VAULT_PROGRESS_COMPLETE=1",
    ].join("\n");
    expect(parseWorkProgress(stdout)).toEqual({ done: 36, total: 36, complete: true });
    expect(stripWorkProgress(stdout)).toBe("No matching records found.");
  });

  it.each([
    "VAULT_PROGRESS_DONE=6\nVAULT_PROGRESS_TOTAL=5\nVAULT_PROGRESS_COMPLETE=0",
    "VAULT_PROGRESS_DONE=5\nVAULT_PROGRESS_TOTAL=5\nVAULT_PROGRESS_COMPLETE=0",
    "VAULT_PROGRESS_DONE=x\nVAULT_PROGRESS_TOTAL=5\nVAULT_PROGRESS_COMPLETE=0",
    "VAULT_XLSX_FILES_DONE=1\nVAULT_XLSX_FILES_TOTAL=1\nVAULT_XLSX_COMPLETE=1",
  ])("rejects malformed, contradictory, or legacy evidence", (stdout) => {
    expect(parseWorkProgress(stdout)).toBeUndefined();
  });

  it("advances only within the same corpus size", () => {
    const first = { done: 1, total: 5, complete: false };
    expect(workProgressAdvanced(first, { ...first, done: 2 })).toBe(true);
    expect(workProgressAdvanced(first, first)).toBe(false);
    expect(workProgressAdvanced(first, { done: 2, total: 6, complete: false })).toBe(false);
  });
});
